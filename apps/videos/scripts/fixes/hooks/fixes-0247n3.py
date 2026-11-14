import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_ONLY = ("afterSettings",)

_spec = importlib.util.spec_from_file_location("hooks_fixes_0244n3", os.path.join(HERE, "fixes-0244n3.py"))
_menus = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_menus)


def clip(seg, side, clip, video_id):
    if seg["scene"] == "u3resetmenu":
        found = _menus.menus(seg["scene"], side, clip["events"], video_id)
        if found:
            clip["menus"] = found
    clip["events"] = [e for e in clip["events"] if "mark" not in e or str(e["mark"])[:1] in ("⌘", "⌃")]
