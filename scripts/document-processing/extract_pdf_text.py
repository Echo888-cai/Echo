#!/usr/bin/env python3
"""PDF text extractor for filing PDFs (HKEX results / SEC docs).

Two engines, same output shape:
  1. pdfminer.six (preferred, `pip3 install --user pdfminer.six`) — ships the
     Adobe CMap tables, so CID-keyed CJK fonts WITHOUT /ToUnicode (the norm in
     HKEX results announcements: MSungHK/MHeiHK, Adobe-CNS1) decode correctly.
  2. builtin fallback (dependency-free) — full scan of `N 0 obj` bodies,
     FlateDecode + ObjStm, nested /Pages, per-font /ToUnicode CMaps. Handles
     PDFs whose fonts carry ToUnicode; CJK w/o ToUnicode comes out blank.

Both engines re-assemble rows by text Y coordinate so table cells
(科目 + 数字列) land on one physical line — required for statement parsing
downstream.

Output: pages delimited by `===== PAGE n =====`, one visual row per line,
cells separated by two spaces.

Builtin engine scope (deliberately not a full renderer):
  - FlateDecode streams, object streams (ObjStm), xref streams ignored (we scan
    all `N 0 obj` bodies directly, which tolerates incremental updates)
  - nested /Pages trees with inherited /Resources
  - per-font /ToUnicode CMaps (bfchar + bfrange, array form included)
  - Tj / TJ / ' / " text-showing operators, hex and literal strings
"""
import argparse
import pathlib
import re
import zlib


OBJ_HEAD_RE = re.compile(rb"(\d+)\s+\d+\s+obj\b")
STREAM_KW_RE = re.compile(rb"stream(\r\n|\n|\r)")


# ─── object table ────────────────────────────────────────────────────

def parse_objects(data):
    """Scan every top-level `N G obj` … `endobj`. Returns {num: (dict_bytes, raw_stream|None)}."""
    objects = {}
    pos = 0
    while True:
        m = OBJ_HEAD_RE.search(data, pos)
        if not m:
            break
        num = int(m.group(1))
        body_start = m.end()
        endobj = data.find(b"endobj", body_start)
        if endobj == -1:
            endobj = len(data)
        sm = STREAM_KW_RE.search(data, body_start, endobj + 9)
        if sm and sm.start() < endobj:
            dict_part = data[body_start:sm.start()]
            data_start = sm.end()
            lm = re.search(rb"/Length\s+(\d+)(?!\s+0\s+R)", dict_part)
            stream_end = -1
            if lm:
                candidate = data_start + int(lm.group(1))
                if data[candidate:candidate + 12].lstrip(b"\r\n \t").startswith(b"endstream"):
                    stream_end = candidate
            if stream_end == -1:
                stream_end = data.find(b"endstream", data_start)
                if stream_end == -1:
                    stream_end = endobj
            objects[num] = (dict_part, data[data_start:stream_end])
            after = data.find(b"endobj", stream_end)
            pos = after + 6 if after != -1 else stream_end
        else:
            objects[num] = (data[body_start:endobj].strip(), None)
            pos = endobj + 6
    expand_object_streams(objects)
    return objects


def decoded_stream(obj):
    dict_part, raw = obj
    if raw is None:
        return dict_part
    if b"FlateDecode" in dict_part:
        try:
            return zlib.decompress(raw)
        except zlib.error:
            try:
                return zlib.decompressobj().decompress(raw)
            except zlib.error:
                return raw
    return raw


def expand_object_streams(objects):
    """Inflate /ObjStm containers so compressed objects become addressable."""
    extra = {}
    for _num, obj in list(objects.items()):
        dict_part, raw = obj
        if raw is None or b"/ObjStm" not in dict_part:
            continue
        content = decoded_stream(obj)
        first_m = re.search(rb"/First\s+(\d+)", dict_part)
        if not first_m:
            continue
        first = int(first_m.group(1))
        header = content[:first]
        nums = [int(v) for v in re.findall(rb"\d+", header)]
        pairs = list(zip(nums[0::2], nums[1::2]))
        for index, (obj_num, offset) in enumerate(pairs):
            end = pairs[index + 1][1] if index + 1 < len(pairs) else len(content) - first
            extra[obj_num] = (content[first + offset:first + end].strip(), None)
    for num, obj in extra.items():
        objects.setdefault(num, obj)


# ─── dict navigation ─────────────────────────────────────────────────

def balanced(text, open_tok, close_tok):
    depth = 0
    i = 0
    while i < len(text):
        if text.startswith(open_tok, i):
            depth += 1
            i += len(open_tok)
        elif text.startswith(close_tok, i):
            depth -= 1
            i += len(close_tok)
            if depth == 0:
                return text[:i]
        else:
            i += 1
    return text


def dict_value(objects, body, key):
    """Value bytes for /key: inline <<…>> or […] kept literal, references resolved to the target's dict bytes."""
    if body is None:
        return None
    m = re.search(rb"/" + key + rb"(?![A-Za-z])\s*", body)
    if not m:
        return None
    rest = body[m.end():]
    if rest.startswith(b"<<"):
        return balanced(rest, b"<<", b">>")
    if rest.startswith(b"["):
        return balanced(rest, b"[", b"]")
    ref = re.match(rb"(\d+)\s+0\s+R", rest)
    if ref:
        target = objects.get(int(ref.group(1)))
        return target[0] if target else None
    tok = re.match(rb"[^/\s>\]]+", rest)
    return tok.group(0) if tok else None


# ─── pages tree ──────────────────────────────────────────────────────

def collect_pages(objects):
    """Walk catalog → /Pages → /Kids, tracking inherited /Resources. Returns [(page_dict, resources_bytes)]."""
    root_ref = None
    for _num, (dict_part, raw) in objects.items():
        if raw is None and b"/Catalog" in dict_part:
            m = re.search(rb"/Pages\s+(\d+)\s+0\s+R", dict_part)
            if m:
                root_ref = int(m.group(1))
                break
    pages = []
    seen = set()

    def walk(ref, inherited_resources, depth):
        if ref in seen or depth > 64:
            return
        seen.add(ref)
        obj = objects.get(ref)
        if not obj:
            return
        body = obj[0]
        resources = dict_value(objects, body, b"Resources") or inherited_resources
        kids = re.search(rb"/Kids\s*\[(.*?)\]", body, re.S)
        if kids and not re.search(rb"/Type\s*/Page(?![a-zA-Z])", body):
            for kid in re.findall(rb"(\d+)\s+0\s+R", kids.group(1)):
                walk(int(kid), resources, depth + 1)
        elif b"/Contents" in body:
            pages.append((body, resources))

    if root_ref is not None:
        walk(root_ref, None, 0)
    if not pages:  # fallback: any object that looks like a page
        for _num, (dict_part, raw) in objects.items():
            if raw is None and re.search(rb"/Type\s*/Page(?![a-zA-Z])", dict_part) and b"/Contents" in dict_part:
                pages.append((dict_part, dict_value(objects, dict_part, b"Resources")))
    return pages


def page_content(objects, page_dict):
    m = re.search(rb"/Contents\s*((\d+\s+0\s+R)|\[[^\]]*\])", page_dict)
    if not m:
        return b""
    refs = [int(r) for r in re.findall(rb"(\d+)\s+0\s+R", m.group(1))]
    chunks = []
    for ref in refs:
        obj = objects.get(ref)
        if not obj:
            continue
        if obj[1] is None and obj[0].lstrip().startswith(b"["):  # ref → array of refs
            for sub in re.findall(rb"(\d+)\s+0\s+R", obj[0]):
                sub_obj = objects.get(int(sub))
                if sub_obj:
                    chunks.append(decoded_stream(sub_obj))
        else:
            chunks.append(decoded_stream(obj))
    return b"\n".join(chunks)


# ─── ToUnicode CMaps ─────────────────────────────────────────────────

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
        for src_start, src_end, dst_array in re.findall(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", block, re.S
        ):
            start = int(src_start, 16)
            width = len(src_start)
            for index, dst in enumerate(re.findall(rb"<([0-9A-Fa-f]+)>", dst_array)):
                cmap[f"{start + index:0{width}x}"] = decode_utf16_hex(dst)
        for src_start, src_end, dst_start in re.findall(
            rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block
        ):
            start = int(src_start, 16)
            end = int(src_end, 16)
            dst = int(dst_start, 16)
            width = len(src_start)
            for value in range(start, end + 1):
                cmap[f"{value:0{width}x}"] = chr(dst + value - start)
    width = 4
    if cmap:
        widths = [len(k) for k in cmap]
        width = max(set(widths), key=widths.count)
    return {"map": cmap, "width": width}


def fonts_for(objects, resources, cmap_cache):
    if not resources:
        return {}
    font_dict = dict_value(objects, resources, b"Font")
    if not font_dict:
        return {}
    fonts = {}
    for name, ref in re.findall(rb"/([^\s/<>\[\]()]+)\s+(\d+)\s+0\s+R", font_dict):
        font_obj = objects.get(int(ref))
        if not font_obj:
            continue
        unicode_ref = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", font_obj[0])
        if not unicode_ref:
            continue
        cmap_num = int(unicode_ref.group(1))
        if cmap_num not in cmap_cache:
            cmap_obj = objects.get(cmap_num)
            cmap_cache[cmap_num] = parse_cmap(decoded_stream(cmap_obj)) if cmap_obj else None
        if cmap_cache[cmap_num]:
            fonts[name.decode("ascii", "replace")] = cmap_cache[cmap_num]
    return fonts


# ─── content-stream text extraction ──────────────────────────────────

TOKEN_RE = re.compile(
    rb"<([0-9A-Fa-f\s]*)>"          # 1 hex string
    rb"|\(((?:\\.|[^\\()])*)\)"      # 2 literal string
    rb"|/([^\s/<>\[\]()]+)"          # 3 name
    rb"|([-+]?\d*\.?\d+)"            # 4 number
    rb"|(\[|\])"                     # 5 array delim
    rb"|([A-Za-z'\"*]{1,3})"         # 6 operator
)

LITERAL_ESCAPES = {b"n": "\n", b"r": "\r", b"t": "\t", b"(": "(", b")": ")", b"\\": "\\"}


def decode_hex_with_cmap(hex_text, cmap):
    mapping, width = cmap["map"], cmap["width"]
    text = ""
    if len(hex_text) % width:
        hex_text += "0" * (width - len(hex_text) % width)
    for index in range(0, len(hex_text), width):
        text += mapping.get(hex_text[index:index + width].lower(), "")
    return text


def decode_literal(raw, cmap):
    # Un-escape into bytes first.
    out = bytearray()
    i = 0
    while i < len(raw):
        if raw[i:i + 1] == b"\\" and i + 1 < len(raw):
            nxt = raw[i + 1:i + 2]
            if nxt in LITERAL_ESCAPES:
                out.extend(LITERAL_ESCAPES[nxt].encode("latin1"))
                i += 2
                continue
            octal = re.match(rb"\\([0-7]{1,3})", raw[i:])
            if octal:
                out.append(int(octal.group(1), 8) & 0xFF)
                i += len(octal.group(0))
                continue
            i += 1
            continue
        out.append(raw[i])
        i += 1
    if cmap and cmap["width"] == 4:
        return decode_hex_with_cmap(bytes(out).hex(), cmap)
    return bytes(out).decode("latin1", "replace")


def extract_page_items(stream, fonts, initial_font=None):
    """Returns (items, last_font); items = [(y, x, order, text)] for every text-showing op."""
    items = []
    font = initial_font
    x = y = 0.0
    leading = 0.0
    order = 0
    stack = []          # recent number operands
    in_array = None     # collected strings inside [ … ] TJ

    def show(text):
        nonlocal order
        if text:
            items.append((y, x, order, text))
            order += 1

    for m in TOKEN_RE.finditer(stream):
        hex_s, lit_s, name, number, arr, op = m.groups()
        if hex_s is not None:
            cmap = fonts.get(font)
            decoded = decode_hex_with_cmap(hex_s.decode("ascii", "replace").replace(" ", "").replace("\n", "").replace("\r", ""), cmap) if cmap else ""
            if in_array is not None:
                in_array.append(decoded)
            else:
                stack.append(("str", decoded))
        elif lit_s is not None:
            decoded = decode_literal(lit_s, fonts.get(font))
            if in_array is not None:
                in_array.append(decoded)
            else:
                stack.append(("str", decoded))
        elif name is not None:
            stack.append(("name", name.decode("ascii", "replace")))
        elif number is not None:
            if in_array is None:
                stack.append(("num", float(number)))
        elif arr == b"[":
            in_array = []
        elif arr == b"]":
            stack.append(("arr", in_array or []))
            in_array = None
        elif op:
            operator = op.decode("ascii", "replace")
            nums = [v for kind, v in stack if kind == "num"]
            if operator == "Tf":
                names = [v for kind, v in stack if kind == "name"]
                if names:
                    font = names[-1]
            elif operator == "Tm" and len(nums) >= 6:
                x, y = nums[-2], nums[-1]
            elif operator == "Td" and len(nums) >= 2:
                x += nums[-2]
                y += nums[-1]
            elif operator == "TD" and len(nums) >= 2:
                leading = -nums[-1]
                x += nums[-2]
                y += nums[-1]
            elif operator == "TL" and nums:
                leading = nums[-1]
            elif operator == "T*":
                y -= leading
            elif operator == "Tj":
                strs = [v for kind, v in stack if kind == "str"]
                if strs:
                    show(strs[-1])
            elif operator in ("'", '"'):
                y -= leading
                strs = [v for kind, v in stack if kind == "str"]
                if strs:
                    show(strs[-1])
            elif operator == "TJ":
                arrays = [v for kind, v in stack if kind == "arr"]
                if arrays:
                    show("".join(arrays[-1]))
            elif operator == "BT":
                x = y = 0.0
            stack = []
    return items, font


def items_to_lines(items):
    """Group show-ops into visual rows by Y (2-unit tolerance), order cells by X."""
    if not items:
        return []
    rows = []  # [ [y, [(x, order, text), …]] ]
    for y, x, order, text in sorted(items, key=lambda it: (-it[0], it[1], it[2])):
        if rows and abs(rows[-1][0] - y) <= 3:
            rows[-1][1].append((x, order, text))
        else:
            rows.append([y, [(x, order, text)]])
    lines = []
    for _y, cells in rows:
        cells.sort(key=lambda c: (c[0], c[1]))
        line = "  ".join(c[2].strip() for c in cells if c[2].strip())
        if line:
            lines.append(line)
    return lines


def extract_text_pdfminer(pdf_path):
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer, LTTextLine

    chunks = []
    for page_index, page in enumerate(extract_pages(str(pdf_path)), start=1):
        items = []
        for element in page:
            if not isinstance(element, LTTextContainer):
                continue
            for line in element:
                if isinstance(line, LTTextLine):
                    text = line.get_text().strip()
                    if text:
                        items.append((line.y0, line.x0, 0, text))
        lines = items_to_lines(items)
        if lines:
            chunks.append(f"===== PAGE {page_index} =====\n" + "\n".join(lines))
    return "\n\n".join(chunks)


def extract_text_builtin(pdf_path):
    objects = parse_objects(pdf_path.read_bytes())
    cmap_cache = {}
    chunks = []
    font = None
    for page_index, (page_dict, resources) in enumerate(collect_pages(objects), start=1):
        fonts = fonts_for(objects, resources, cmap_cache)
        stream = page_content(objects, page_dict)
        if not stream:
            continue
        items, font = extract_page_items(stream, fonts, font)
        lines = items_to_lines(items)
        if lines:
            chunks.append(f"===== PAGE {page_index} =====\n" + "\n".join(lines))
    return "\n\n".join(chunks)


def extract_text(pdf_path):
    try:
        import pdfminer  # noqa: F401
    except ImportError:
        return extract_text_builtin(pdf_path)
    try:
        text = extract_text_pdfminer(pdf_path)
        if text:
            return text
    except Exception:
        pass
    return extract_text_builtin(pdf_path)


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
