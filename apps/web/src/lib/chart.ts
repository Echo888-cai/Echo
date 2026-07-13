// SVG path math shared by stock and portfolio charts.
export interface ChartPoint {
  close: number;
}

export interface ChartPaths {
  line: string;
  area: string;
  dotX: number;
  dotY: number;
  up: boolean;
  retPct: number;
}

export function buildChartPaths(pts: ChartPoint[], W: number, H: number): ChartPaths {
  const top = 8;
  const bot = H - 8;
  const drawH = bot - top;
  const closes = pts.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const n = pts.length;
  const xy = pts.map((p, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * W;
    const y = bot - ((p.close - min) / span) * drawH;
    return [x, y] as const;
  });
  const line = "M" + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  const area = `${line} L${W},${bot} L0,${bot} Z`;
  const first = closes[0];
  const last = closes[n - 1];
  return {
    line,
    area,
    dotX: xy[n - 1][0],
    dotY: xy[n - 1][1],
    up: last >= first,
    retPct: ((last - first) / first) * 100
  };
}
