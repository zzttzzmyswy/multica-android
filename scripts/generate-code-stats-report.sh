#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_FILE="${1:-$ROOT_DIR/docs/code-stats-report.html}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

cd "$ROOT_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this script must run inside a git repository."
  exit 1
fi

# 1) Snapshot LOC from tracked files.
while IFS= read -r -d '' file; do
  if [ -f "$file" ]; then
    wc -l "$file"
  fi
done < <(git ls-files -z) > "$TMP_DIR/wc_all.txt"

awk -v out_by_ext="$TMP_DIR/loc_by_ext.tsv" -v out_totals="$TMP_DIR/loc_totals.tsv" '
{
  lines = $1
  $1 = ""
  sub(/^ +/, "")
  file = $0

  n = split(file, parts, "/")
  base = parts[n]
  ext = base

  if (index(base, ".") > 0) {
    sub(/.*\./, "", ext)
  } else {
    ext = "[noext]"
  }

  ext_lines[ext] += lines
  ext_files[ext] += 1
  files += 1
  lines_all += lines
}
END {
  for (e in ext_lines) {
    printf "%s\t%d\t%d\n", e, ext_files[e], ext_lines[e] > out_by_ext
  }

  source_lines = 0
  source_files = 0
  doc_lines = 0
  doc_files = 0
  cfg_lines = 0
  cfg_files = 0

  for (e in ext_lines) {
    if (e ~ /^(ts|tsx|js|jsx|mjs|cjs|py|css|scss|html|sh)$/) {
      source_lines += ext_lines[e]
      source_files += ext_files[e]
    }
    if (e == "md") {
      doc_lines += ext_lines[e]
      doc_files += ext_files[e]
    }
    if (e ~ /^(json|json5|yaml|yml|xsd)$/) {
      cfg_lines += ext_lines[e]
      cfg_files += ext_files[e]
    }
  }

  printf "files\t%d\nlines\t%d\nsource_files\t%d\nsource_lines\t%d\ndoc_files\t%d\ndoc_lines\t%d\nconfig_files\t%d\nconfig_lines\t%d\n", files, lines_all, source_files, source_lines, doc_files, doc_lines, cfg_files, cfg_lines > out_totals
}
' "$TMP_DIR/wc_all.txt"

# 2) Contribution by author (email-normalized).
git log --all --no-merges --numstat --format='@@@%aN|%aE' | awk -v out="$TMP_DIR/author_by_email.tsv" '
BEGIN { FS = "\t" }
/^@@@/ {
  split(substr($0, 4), h, /\|/)
  name = h[1]
  email = h[2]
  id = email

  if (!(id in display)) {
    display[id] = name " <" email ">"
  }

  commits[id] += 1
  next
}
NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
  adds[id] += $1
  dels[id] += $2
}
END {
  for (k in commits) {
    printf "%s\t%d\t%d\t%d\t%d\n", display[k], commits[k], adds[k] + 0, dels[k] + 0, (adds[k] - dels[k]) + 0 > out
  }
}
'

sort -t $'\t' -k3,3nr "$TMP_DIR/author_by_email.tsv" > "$TMP_DIR/author_by_email.sorted.tsv"

awk -F '\t' -v out="$TMP_DIR/author_human_share.tsv" '
$1 !~ /checkpointer@noreply|dependabot\[bot\]/ {
  total_commits += $2
  total_adds += $3
  rows[++n] = $0
}
END {
  for (i = 1; i <= n; i++) {
    split(rows[i], f, "\t")
    add_pct = (total_adds > 0) ? (f[3] / total_adds * 100) : 0
    commit_pct = (total_commits > 0) ? (f[2] / total_commits * 100) : 0
    printf "%s\t%d\t%d\t%d\t%d\t%.2f%%\t%.2f%%\n", f[1], f[2], f[3], f[4], f[5], add_pct, commit_pct > out
  }
}
' "$TMP_DIR/author_by_email.sorted.tsv"

# 3) Contribution by author/day/hour.
git log --all --no-merges --numstat --date=format:'%Y-%m-%d|%H' --format='@@@%aE|%ad' | awk -v out="$TMP_DIR/author_day_hour_summary.tsv" '
BEGIN { FS = "\t" }
/^@@@/ {
  split(substr($0, 4), h, /\|/)
  email = h[1]
  day = h[2]
  hour = h[3]

  key = email "\t" day "\t" hour
  commits[key] += 1
  next
}
NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {
  adds[key] += $1
  dels[key] += $2
}
END {
  for (k in commits) {
    split(k, f, "\t")
    a = adds[k] + 0
    d = dels[k] + 0
    printf "%s\t%s\t%s\t%d\t%d\t%d\t%d\n", f[1], f[2], f[3], commits[k], a, d, (a - d) > out
  }
}
'

awk -F '\t' -v out="$TMP_DIR/day_summary_human.tsv" '
$1 !~ /checkpointer@noreply|dependabot\[bot\]/ {
  day = $2
  commits[day] += $4
  adds[day] += $5
  dels[day] += $6

  if (!(day in min_hour) || $3 < min_hour[day]) {
    min_hour[day] = $3
  }

  if (!(day in max_hour) || $3 > max_hour[day]) {
    max_hour[day] = $3
  }
}
END {
  for (d in commits) {
    printf "%s\t%d\t%d\t%d\t%d\t%s\t%s\n", d, commits[d], adds[d], dels[d], adds[d] - dels[d], min_hour[d], max_hour[d] > out
  }
}
' "$TMP_DIR/author_day_hour_summary.tsv"

sort -t $'\t' -k1,1 "$TMP_DIR/day_summary_human.tsv" -o "$TMP_DIR/day_summary_human.tsv"

awk -F '\t' -v out="$TMP_DIR/hour_summary_human.tsv" '
$1 !~ /checkpointer@noreply|dependabot\[bot\]/ {
  hour = $3
  commits[hour] += $4
  adds[hour] += $5
  dels[hour] += $6
}
END {
  for (i = 0; i < 24; i++) {
    h = sprintf("%02d", i)
    a = adds[h] + 0
    d = dels[h] + 0
    printf "%s\t%d\t%d\t%d\t%d\n", h, commits[h] + 0, a, d, a - d > out
  }
}
' "$TMP_DIR/author_day_hour_summary.tsv"

sort -t $'\t' -k1,1 "$TMP_DIR/hour_summary_human.tsv" -o "$TMP_DIR/hour_summary_human.tsv"

awk -F '\t' -v out="$TMP_DIR/day_peak_hour_human.tsv" '
$1 !~ /checkpointer@noreply|dependabot\[bot\]/ {
  key = $2 "\t" $3
  commits[key] += $4
  adds[key] += $5
  dels[key] += $6
}
END {
  for (k in adds) {
    split(k, parts, "\t")
    day = parts[1]
    hour = parts[2]

    if (!(day in max_adds) || adds[k] > max_adds[day]) {
      max_adds[day] = adds[k]
      best_hour[day] = hour
      best_commits[day] = commits[k]
      best_dels[day] = dels[k]
    }
  }

  for (d in max_adds) {
    printf "%s\t%s\t%d\t%d\t%d\n", d, best_hour[d], best_commits[d], max_adds[d], best_dels[d] > out
  }
}
' "$TMP_DIR/author_day_hour_summary.tsv"

sort -t $'\t' -k1,1 "$TMP_DIR/day_peak_hour_human.tsv" -o "$TMP_DIR/day_peak_hour_human.tsv"

mkdir -p "$(dirname "$OUT_FILE")"

# 4) Render standalone HTML.
{
cat <<'HTML_HEAD'
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Super Multica 代码贡献统计</title>
  <style>
    :root {
      --bg: #0b0d10;
      --panel: #14181d;
      --panel-2: #1a2027;
      --line: #2a3440;
      --text: #e8edf3;
      --muted: #98a7b7;
      --ok: #2fbf71;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial;
      background: radial-gradient(circle at 20% -10%, #1a2430 0%, #0b0d10 45%) fixed;
      color: var(--text);
      line-height: 1.4;
    }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .sub { color: var(--muted); margin-bottom: 20px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
    }
    .k { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .v { font-size: 24px; font-weight: 700; letter-spacing: 0.3px; }
    .section { margin-top: 14px; }
    .section h2 { margin: 0 0 10px; font-size: 16px; color: #d4dde7; }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
    th { background: #11161c; text-align: left; color: #c5d0db; position: sticky; top: 0; }
    tr:last-child td { border-bottom: 0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .bar-wrap { background: #0f1318; border-radius: 999px; height: 8px; width: 180px; border: 1px solid #273241; }
    .bar { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #3f7ef7, #58a6ff); }
    .ok { color: var(--ok); }
    .danger { color: var(--danger); }
    .foot { margin-top: 16px; color: var(--muted); font-size: 12px; }
    .scroll { max-height: 420px; overflow: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Super Multica 代码贡献统计</h1>
    <div class="sub" id="subtitle"></div>

    <div class="grid" id="summary"></div>

    <div class="section">
      <h2>代码量分布（按扩展名）</h2>
      <div class="panel scroll"><table id="extTable"></table></div>
    </div>

    <div class="section">
      <h2>人员贡献（人工口径）</h2>
      <div class="panel scroll"><table id="authorTable"></table></div>
    </div>

    <div class="section">
      <h2>每日贡献（人工口径）</h2>
      <div class="panel scroll"><table id="dayTable"></table></div>
    </div>

    <div class="section">
      <h2>小时段贡献（人工口径）</h2>
      <div class="panel scroll"><table id="hourTable"></table></div>
    </div>

    <div class="foot">数据来源：git log --numstat 与当前工作树文件统计。人工口径排除 checkpointer / dependabot。</div>
  </div>

  <script>
    const RAW = {
      locTotals: String.raw`
HTML_HEAD
cat "$TMP_DIR/loc_totals.tsv"
cat <<'MID1'
`,
      locByExt: String.raw`
MID1
cat "$TMP_DIR/loc_by_ext.tsv"
cat <<'MID2'
`,
      authorHuman: String.raw`
MID2
cat "$TMP_DIR/author_human_share.tsv"
cat <<'MID3'
`,
      dayHuman: String.raw`
MID3
cat "$TMP_DIR/day_summary_human.tsv"
cat <<'MID4'
`,
      hourHuman: String.raw`
MID4
cat "$TMP_DIR/hour_summary_human.tsv"
cat <<'MID5'
`,
      dayPeak: String.raw`
MID5
cat "$TMP_DIR/day_peak_hour_human.tsv"
cat <<'HTML_TAIL'
`
    };

    const fmt = (n) => Number(n).toLocaleString("en-US");
    const tsv = (txt) => txt.trim().split(/\n+/).map((line) => line.split("\t"));
    const toNum = (v) => Number(v || 0);

    const locTotalsRows = tsv(RAW.locTotals);
    const locTotals = Object.fromEntries(locTotalsRows.map(([k, v]) => [k, toNum(v)]));

    const extRows = tsv(RAW.locByExt).map(([ext, files, lines]) => ({
      ext,
      files: toNum(files),
      lines: toNum(lines),
    })).sort((a, b) => b.lines - a.lines);

    const authors = tsv(RAW.authorHuman).map(([name, commits, add, del, net, addPct, commitPct]) => ({
      name,
      commits: toNum(commits),
      add: toNum(add),
      del: toNum(del),
      net: toNum(net),
      addPct,
      commitPct,
    })).sort((a, b) => b.add - a.add);

    const dayPeaks = Object.fromEntries(tsv(RAW.dayPeak).map(([d, h, c, a, del]) => [d, {
      hour: h,
      commits: toNum(c),
      add: toNum(a),
      del: toNum(del),
    }]));

    const days = tsv(RAW.dayHuman).map(([date, commits, add, del, net, startHour, endHour]) => ({
      date,
      commits: toNum(commits),
      add: toNum(add),
      del: toNum(del),
      net: toNum(net),
      startHour,
      endHour,
      peak: dayPeaks[date] || null,
    })).sort((a, b) => a.date.localeCompare(b.date));

    const hours = tsv(RAW.hourHuman).map(([hour, commits, add, del, net]) => ({
      hour,
      commits: toNum(commits),
      add: toNum(add),
      del: toNum(del),
      net: toNum(net),
    })).sort((a, b) => a.hour.localeCompare(b.hour));

    const totalHumanCommits = authors.reduce((sum, x) => sum + x.commits, 0);
    const totalHumanAdd = authors.reduce((sum, x) => sum + x.add, 0);
    const totalHumanDel = authors.reduce((sum, x) => sum + x.del, 0);
    const topHour = [...hours].sort((a, b) => b.add - a.add)[0] || { hour: "--", add: 0 };
    const startDate = days[0]?.date || "--";
    const endDate = days[days.length - 1]?.date || "--";

    document.getElementById("subtitle").textContent = `${startDate} ~ ${endDate}`;

    const summaryItems = [
      ["总文件数", fmt(locTotals.files || 0)],
      ["总行数", fmt(locTotals.lines || 0)],
      ["源码行数", fmt(locTotals.source_lines || 0)],
      ["贡献人数", fmt(authors.length)],
      ["人工提交数", fmt(totalHumanCommits)],
      ["人工新增", fmt(totalHumanAdd)],
      ["人工删除", fmt(totalHumanDel)],
      ["最高产小时", `${topHour.hour}:00 (${fmt(topHour.add)})`],
    ];

    document.getElementById("summary").innerHTML = summaryItems.map(([k, v]) => (
      `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`
    )).join("");

    const maxExtLines = Math.max(...extRows.map((x) => x.lines), 1);
    document.getElementById("extTable").innerHTML = `
      <thead><tr><th>扩展名</th><th class="num">文件数</th><th class="num">行数</th><th>占比</th><th>可视化</th></tr></thead>
      <tbody>
        ${extRows.map((r) => {
          const pct = ((r.lines / (locTotals.lines || 1)) * 100).toFixed(2);
          const w = ((r.lines / maxExtLines) * 100).toFixed(1);
          return `<tr>
            <td class="mono">${r.ext}</td>
            <td class="num">${fmt(r.files)}</td>
            <td class="num">${fmt(r.lines)}</td>
            <td class="num">${pct}%</td>
            <td><div class="bar-wrap"><div class="bar" style="width:${w}%"></div></div></td>
          </tr>`;
        }).join("")}
      </tbody>`;

    document.getElementById("authorTable").innerHTML = `
      <thead><tr><th>作者</th><th class="num">提交</th><th class="num">新增</th><th class="num">删除</th><th class="num">净新增</th><th class="num">新增占比</th><th class="num">提交占比</th></tr></thead>
      <tbody>
        ${authors.map((a) => `<tr>
          <td>${a.name}</td>
          <td class="num">${fmt(a.commits)}</td>
          <td class="num">${fmt(a.add)}</td>
          <td class="num">${fmt(a.del)}</td>
          <td class="num ${a.net >= 0 ? "ok" : "danger"}">${fmt(a.net)}</td>
          <td class="num">${a.addPct}</td>
          <td class="num">${a.commitPct}</td>
        </tr>`).join("")}
      </tbody>`;

    document.getElementById("dayTable").innerHTML = `
      <thead><tr><th>日期</th><th class="num">提交</th><th class="num">新增</th><th class="num">删除</th><th class="num">净新增</th><th>活跃时段</th><th>峰值小时</th></tr></thead>
      <tbody>
        ${days.map((d) => `<tr>
          <td class="mono">${d.date}</td>
          <td class="num">${fmt(d.commits)}</td>
          <td class="num">${fmt(d.add)}</td>
          <td class="num">${fmt(d.del)}</td>
          <td class="num ${d.net >= 0 ? "ok" : "danger"}">${fmt(d.net)}</td>
          <td class="mono">${d.startHour}:00 - ${d.endHour}:59</td>
          <td class="mono">${d.peak ? `${d.peak.hour}:00 (${fmt(d.peak.add)})` : "--"}</td>
        </tr>`).join("")}
      </tbody>`;

    const maxHourAdd = Math.max(...hours.map((h) => h.add), 1);
    document.getElementById("hourTable").innerHTML = `
      <thead><tr><th>小时</th><th class="num">提交</th><th class="num">新增</th><th class="num">删除</th><th class="num">净新增</th><th>可视化</th></tr></thead>
      <tbody>
        ${hours.map((h) => {
          const w = ((h.add / maxHourAdd) * 100).toFixed(1);
          return `<tr>
            <td class="mono">${h.hour}:00</td>
            <td class="num">${fmt(h.commits)}</td>
            <td class="num">${fmt(h.add)}</td>
            <td class="num">${fmt(h.del)}</td>
            <td class="num ${h.net >= 0 ? "ok" : "danger"}">${fmt(h.net)}</td>
            <td><div class="bar-wrap"><div class="bar" style="width:${w}%"></div></div></td>
          </tr>`;
        }).join("")}
      </tbody>`;
  </script>
</body>
</html>
HTML_TAIL
} > "$OUT_FILE"

echo "Report generated: $OUT_FILE"
