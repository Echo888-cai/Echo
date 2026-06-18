#!/usr/bin/env python3
import argparse
import pathlib
import re
import zlib


STREAM_RE = re.compile(
    rb"(?P<num>\d+)\s+0\s+obj\s*(?P<body>.*?)\s*endobj", re.S
)


def maybe_decode_stream(body):
    match = re.search(rb"<<(?P<dict>.*?)>>\s*stream\r?\n(?P<data>.*?)\r?\nendstream", body, re.S)
    if not match:
        return body

    stream_dict = match.group("dict")
    stream_data = match.group("data")
    if b"FlateDecode" not in stream_dict:
        return stream_data

    try:
        return zlib.decompress(stream_data)
    except zlib.error:
        return stream_data


def load_objects(pdf_bytes):
    objects = {}
    raw_objects = {}

    for match in STREAM_RE.finditer(pdf_bytes):
        number = int(match.group("num"))
        body = match.group("body")
        raw_objects[number] = body
        objects[number] = maybe_decode_stream(body)

    for number, raw_body in list(raw_objects.items()):
        if b"/Type /ObjStm" not in raw_body:
            continue

        stream_match = re.search(
            rb"<<(?P<dict>.*?)>>\s*stream\r?\n(?P<data>.*?)\r?\nendstream",
            raw_body,
            re.S,
        )
        if not stream_match:
            continue

        stream_dict = stream_match.group("dict")
        stream_data = stream_match.group("data")
        if b"FlateDecode" in stream_dict:
            try:
                stream_data = zlib.decompress(stream_data)
            except zlib.error:
                continue

        first_match = re.search(rb"/First\s+(\d+)", stream_dict)
        if not first_match:
            continue

        first = int(first_match.group(1))
        header = stream_data[:first]
        content = stream_data[first:]
        values = [int(value) for value in re.findall(rb"\d+", header)]
        pairs = list(zip(values[0::2], values[1::2]))

        for index, (obj_number, offset) in enumerate(pairs):
            end = pairs[index + 1][1] if index + 1 < len(pairs) else len(content)
            objects[obj_number] = content[offset:end].strip()

    return objects


def decode_utf16_hex(hex_text):
    data = bytes.fromhex(hex_text.decode("ascii"))
    if len(data) % 2:
        data += b"\x00"
    return data.decode("utf-16-be", "replace")


def parse_cmap(cmap_bytes):
    cmap = {}

    for block in re.findall(rb"beginbfchar(.*?)endbfchar", cmap_bytes, re.S):
        for src, dst in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            cmap[src.decode("ascii").lower()] = decode_utf16_hex(dst)

    for block in re.findall(rb"beginbfrange(.*?)endbfrange", cmap_bytes, re.S):
        for src_start, src_end, dst_start in re.findall(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>",
            block,
        ):
            start = int(src_start, 16)
            end = int(src_end, 16)
            dst = int(dst_start, 16)
            width = len(src_start)
            for value in range(start, end + 1):
                cmap[f"{value:0{width}x}"] = chr(dst + value - start)

        for src_start, src_end, dst_array in re.findall(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]",
            block,
            re.S,
        ):
            start = int(src_start, 16)
            values = re.findall(rb"<([0-9A-Fa-f]+)>", dst_array)
            width = len(src_start)
            for index, dst in enumerate(values):
                cmap[f"{start + index:0{width}x}"] = decode_utf16_hex(dst)

    return cmap


def decode_hex_string(hex_text, cmap):
    text = ""
    if len(hex_text) % 4:
        hex_text = hex_text + ("0" * (4 - len(hex_text) % 4))
    for index in range(0, len(hex_text), 4):
        code = hex_text[index : index + 4].lower()
        text += cmap.get(code, "")
    return text


def font_maps(objects):
    cmap_by_obj = {}
    for number, body in objects.items():
        if b"begincmap" in body:
            cmap_by_obj[number] = parse_cmap(body)

    maps = {}
    font_resources = objects.get(203, b"")
    for name, ref in re.findall(rb"/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R", font_resources):
        font_obj = objects.get(int(ref), b"")
        unicode_ref = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", font_obj)
        if unicode_ref:
            maps[name.decode("ascii")] = cmap_by_obj.get(int(unicode_ref.group(1)), {})
    return maps


def extract_page_text(page_stream, maps):
    current_font = None
    lines = []

    for block in re.findall(rb"BT(.*?)ET", page_stream, re.S):
        font_match = re.search(rb"/([A-Za-z0-9]+)\s+[-+]?\d+(?:\.\d+)?\s+Tf", block)
        if font_match:
            current_font = font_match.group(1).decode("ascii")

        cmap = maps.get(current_font, {})
        fragments = []
        for match in re.finditer(rb"<([0-9A-Fa-f]+)>|\((.*?)\)\s*Tj", block, re.S):
            if match.group(1):
                fragments.append(decode_hex_string(match.group(1).decode("ascii"), cmap))
            elif match.group(2):
                fragments.append(match.group(2).decode("latin1", "replace"))

        line = "".join(fragments).strip()
        if line:
            lines.append(line)

    return "\n".join(lines)


def extract_text(pdf_path):
    objects = load_objects(pdf_path.read_bytes())
    maps = font_maps(objects)

    page_numbers = []
    pages = objects.get(1, b"")
    kids = re.search(rb"/Kids\s*\[(.*?)\]", pages, re.S)
    if kids:
        page_numbers = [int(num) for num in re.findall(rb"(\d+)\s+0\s+R", kids.group(1))]

    chunks = []
    for page_index, page_obj_number in enumerate(page_numbers, start=1):
        page_obj = objects.get(page_obj_number, b"")
        content_ref = re.search(rb"/Contents\s+(\d+)\s+0\s+R", page_obj)
        if not content_ref:
            continue

        stream_obj = int(content_ref.group(1))
        page_text = extract_page_text(objects.get(stream_obj, b""), maps)
        if page_text:
            chunks.append(f"===== PAGE {page_index} =====\n{page_text}")

    return "\n\n".join(chunks)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("-o", "--output")
    args = parser.parse_args()

    text = extract_text(pathlib.Path(args.pdf))
    if args.output:
        pathlib.Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
