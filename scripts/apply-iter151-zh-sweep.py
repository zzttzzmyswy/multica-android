#!/usr/bin/env python3
"""Iteration 151 — apply the zh punctuation and concept sweep.

Two rules are being applied, both from conventions.mdx:

  * Section 3 punctuation: straight double quotes only (no `「」`, no curly
    quotes), and full-width `，。：；！？` — plus the bracket rule the bundle
    itself settles (full-width everywhere).
  * Section 2 concepts: `Autopilot` → 自动化, `Member` → 成员, `issue` → 任务.

Every edit is a **key-scoped exact substring replacement** with a uniqueness
assertion, never a whole-file `旧值 → 新值` sweep and never a `json.dump`
rewrite: the bundles contain inline objects and values that are substrings of
other values, and the 144 round already got bitten by both.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWS = ROOT / "packages" / "views" / "locales" / "zh-Hans"
MOBILE = ROOT / "apps" / "mobile" / "lib" / "i18n" / "locales" / "zh.json"

# (namespace, key, old value, new value)
EDITS = [
    # --- section 3: 「」 → straight quotes, plus issue → 任务 in the same string
    ("billing", "return_page.load_failed_description",
     "你已从 Stripe 返回，但我们无法加载工作区列表来打开对应的账单页。请到「工作区设置 → 账单」确认当前状态。",
     "你已从 Stripe 返回，但我们无法加载工作区列表来打开对应的账单页。请到\"工作区设置 → 账单\"确认当前状态。"),
    ("issues", "save_view.hint_my_any",
     "基于「我的 issues · 全部」创建", "基于\"我的任务 · 全部\"创建"),
    ("issues", "save_view.hint_my_assigned",
     "基于「我的 issues · 分配给我」创建", "基于\"我的任务 · 分配给我\"创建"),
    ("issues", "save_view.hint_my_created",
     "基于「我的 issues · 我创建的」创建", "基于\"我的任务 · 我创建的\"创建"),
    ("issues", "save_view.hint_my_involved",
     "基于「我的 issues · 我参与的」创建", "基于\"我的任务 · 我参与的\"创建"),
    ("issues", "save_view.hint_project",
     "基于项目「{{title}}」创建，仅在该项目页面可用",
     "基于项目\"{{title}}\"创建，仅在该项目页面可用"),
    ("issues", "save_view.hint_project_agents",
     "基于项目「{{title}}」中智能体负责的 issues 创建，仅在该项目页面可用",
     "基于项目\"{{title}}\"中智能体负责的任务创建，仅在该项目页面可用"),
    ("issues", "save_view.hint_project_members",
     "基于项目「{{title}}」中成员负责的 issues 创建，仅在该项目页面可用",
     "基于项目\"{{title}}\"中成员负责的任务创建，仅在该项目页面可用"),
    ("issues", "view_bar.delete_description",
     "「{{name}}」将对所有可见成员删除", "\"{{name}}\"将对所有可见成员删除"),
    ("runtimes", "detail.visibility_hint_readonly.private",
     "仅运行时所有者可以在此运行时上创建智能体，也只有他们能切换为「公开」。",
     "仅运行时所有者可以在此运行时上创建智能体，也只有他们能切换为\"公开\"。"),
    ("runtimes", "detail.visibility_hint_readonly.public",
     "工作区内任何成员都可以在此运行时上创建智能体。只有运行时所有者能切回「私有」。",
     "工作区内任何成员都可以在此运行时上创建智能体。只有运行时所有者能切回\"私有\"。"),

    # --- section 3: curly quotes → straight
    ("runtimes", "detail.delete_dialog.profile_backed_notice",
     "该运行时来自自定义运行时配置。删除它只会移除当前运行时实例；只要配置仍存在，运行中的守护进程就可以再次注册它。若要彻底移除，请在“自定义运行时”中删除对应配置。",
     "该运行时来自自定义运行时配置。删除它只会移除当前运行时实例；只要配置仍存在，运行中的守护进程就可以再次注册它。若要彻底移除，请在\"自定义运行时\"中删除对应配置。"),
    ("settings", "properties.archive_dialog.description",
     "“{{name}}”将从选择器和筛选中隐藏，任务上已有的值会保留。之后可以恢复。",
     "\"{{name}}\"将从选择器和筛选中隐藏，任务上已有的值会保留。之后可以恢复。"),
    ("squads", "archive_dialog.description",
     "“{{name}}” 将被归档，该小队当前承接的任务会转交给小队负责人。此操作无法撤销，如需恢复路由请新建小队。",
     "\"{{name}}\" 将被归档，该小队当前承接的任务会转交给小队负责人。此操作无法撤销，如需恢复路由请新建小队。"),

    # --- section 3: half-width ，；→ full-width
    ("editor", "image.canvas_label",
     "图片画布,拖动可平移,滚动可缩放,双击可切换实际大小。",
     "图片画布，拖动可平移，滚动可缩放，双击可切换实际大小。"),
    ("editor", "image.unavailable",
     "这张图片已失效,已跳过。", "这张图片已失效，已跳过。"),
    ("editor", "mermaid.canvas_label",
     "图表画布,拖动可平移,滚动可缩放。", "图表画布，拖动可平移，滚动可缩放。"),
    ("agents", "row_actions.set_access_bulk_partial",
     "已应用 {{succeeded}} 个;{{failed}} 个失败(保持当前状态)。",
     "已应用 {{succeeded}} 个；{{failed}} 个失败（保持当前状态）。"),

    # --- section 3: half-width brackets → full-width
    ("agents", "row_actions.set_access_skipped",
     "{{count}} 个已跳过(不是你所有)。", "{{count}} 个已跳过（不是你所有）。"),
    ("search", "commands.copy_identifier",
     "复制标识符 ({{identifier}})", "复制标识符（{{identifier}}）"),
    ("skills", "runtime_import.select_all", "全选 ({{count}})", "全选（{{count}}）"),

    # --- section 2: issue → 任务 (the save_view hints the 「」 edit did not cover)
    ("issues", "save_view.hint_workspace",
     "基于工作区全部 issues 创建", "基于工作区全部任务创建"),
    ("issues", "save_view.hint_workspace_agents",
     "基于工作区中智能体负责的 issues 创建", "基于工作区中智能体负责的任务创建"),
    ("issues", "save_view.hint_workspace_members",
     "基于工作区中成员负责的 issues 创建", "基于工作区中成员负责的任务创建"),
    ("issues", "save_view.my_private_note",
     "我的 issues 视图仅自己可见", "我的任务视图仅自己可见"),

    # --- section 2: Autopilot → 自动化
    ("autopilots", "dialog.webhook_help_create",
     "Autopilot 创建后 Multica 会生成一个 Webhook URL。向它 POST 任意 JSON 即可触发。",
     "自动化创建后 Multica 会生成一个 Webhook URL。向它 POST 任意 JSON 即可触发。"),
    ("autopilots", "dialog.webhook_help_edit",
     "该 Autopilot 由 Webhook 触发。请在详情页复制或重新生成 URL。",
     "该自动化由 Webhook 触发。请在详情页复制或重新生成 URL。"),
    ("autopilots", "dialog.webhook_created_title",
     "Webhook Autopilot 已就绪", "Webhook 自动化已就绪"),
    ("autopilots", "dialog.webhook_created_description",
     "向下方的 URL POST 任意 JSON 即可触发该 Autopilot。请立即复制——之后也能在 Autopilot 详情页查看或重新生成。",
     "向下方的 URL POST 任意 JSON 即可触发该自动化。请立即复制——之后也能在自动化详情页查看或重新生成。"),
    ("autopilots", "dialog.webhook_created_warning",
     "请把该 URL 当作密码对待，任何拿到它的人都能触发该 Autopilot。",
     "请把该 URL 当作密码对待，任何拿到它的人都能触发该自动化。"),
    ("issues", "execution_log.attribution.source_trigger_owner",
     "Autopilot 触发器创建者", "自动化触发器创建者"),
    ("issues", "execution_log.attribution.source_rule_owner",
     "Autopilot 规则发布者", "自动化规则发布者"),

    # --- section 2: Member → 成员
    ("agents", "create_dialog.squad_join_failed_toast",
     "智能体\"{{name}}\"已创建，但加入小队失败：{{error}}。你可以在 Members 标签里手动添加。",
     "智能体\"{{name}}\"已创建，但加入小队失败：{{error}}。你可以在成员标签里手动添加。"),
]

# The mobile bundle is a single flat file; one edit there.
MOBILE_EDITS = [
    ("integrations.vcsTitle", "Git 托管 (VCS)", "Git 托管（VCS）"),
]


def json_token(value: str) -> str:
    """The value as it appears inside a JSON file, without the outer quotes."""
    return json.dumps(value, ensure_ascii=False)[1:-1]


def apply(path: Path, edits, with_namespace: bool) -> int:
    text = path.read_text(encoding="utf8")
    original = text
    for edit in edits:
        if with_namespace:
            namespace, key, old, new = edit
            leaf = key.split(".")[-1]
            old_token = f'"{leaf}": {json.dumps(old, ensure_ascii=False)}'
            new_token = f'"{leaf}": {json.dumps(new, ensure_ascii=False)}'
        else:
            key, old, new = edit
            leaf = key.split(".")[-1]
            old_token = f'"{leaf}": {json.dumps(old, ensure_ascii=False)}'
            new_token = f'"{leaf}": {json.dumps(new, ensure_ascii=False)}'
        hits = text.count(old_token)
        if hits != 1:
            label = f"{namespace}.{key}" if with_namespace else key
            print(f"  SKIP {label}: {hits} matches for {old_token[:70]}…", file=sys.stderr)
            continue
        text = text.replace(old_token, new_token)
        label = f"{namespace}.{key}" if with_namespace else key
        print(f"  ok   {label}")
    if text != original:
        path.write_text(text, encoding="utf8")
    return 0


print("=== views zh-Hans ===")
by_namespace: dict[str, list] = {}
for namespace, key, old, new in EDITS:
    by_namespace.setdefault(namespace, []).append((namespace, key, old, new))
for namespace, edits in sorted(by_namespace.items()):
    apply(VIEWS / f"{namespace}.json", edits, with_namespace=True)

print("=== mobile zh ===")
apply(MOBILE, MOBILE_EDITS, with_namespace=False)

# Re-read through the JSON parser: a broken edit would still be valid JSON here,
# but a broken *file* would not parse, and that is worth catching now.
for namespace in sorted(by_namespace):
    json.loads((VIEWS / f"{namespace}.json").read_text(encoding="utf8"))
json.loads(MOBILE.read_text(encoding="utf8"))
print("all edited files parse as JSON")
