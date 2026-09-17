# -*- coding: utf-8 -*-
"""鲸鱼娘换装渲染：按身体模型锚点把饰品绘制/合成到形象图上。

饰品分两类：
- drawn（内置设计款）：PIL 矢量绘制（多边形/椭圆），palette 来自 body-model.json
- image（贴图款）：PNG 贴图（AI 生成的饰品透明图放 assets/accessories/<id>.png）
"""
import json
import math
import os
from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
CHAR_DIR = os.path.join(ASSETS, 'characters', 'deepseek')


def load_body_model():
    with open(os.path.join(CHAR_DIR, 'body-model.json'), encoding='utf-8') as f:
        return json.load(f)


def _alpha_composite_at(base, part, cx, cy):
    base.alpha_composite(part, (int(cx - part.width / 2), int(cy - part.height / 2)))


def _draw_bow(d, w, h, color, edge):
    """蝴蝶结：左右两翼 + 中心结。画在 (0,0,w,h) 局部坐标。"""
    cxe, cy = w * 0.5, h * 0.55
    s = min(w, h)
    for sign in (-1, 1):
        d.polygon([
            (cxe, cy),
            (cxe + sign * w * 0.48, cy - h * 0.34),
            (cxe + sign * w * 0.44, cy + h * 0.06),
            (cxe + sign * w * 0.40, cy + h * 0.36),
        ], fill=color, outline=edge, width=3)
    d.ellipse([cxe - s * 0.14, cy - s * 0.14, cxe + s * 0.14, cy + s * 0.14], fill=edge)


def _draw_crown(d, w, h, color, edge):
    d.polygon([
        (w * 0.10, h * 0.85), (w * 0.10, h * 0.35), (w * 0.30, h * 0.60),
        (w * 0.50, h * 0.10), (w * 0.70, h * 0.60), (w * 0.90, h * 0.35), (w * 0.90, h * 0.85),
    ], fill=color, outline=edge, width=3)
    d.ellipse([w * 0.42, h * 0.52, w * 0.58, h * 0.70], fill=edge)  # 宝石
    for fx in (0.10, 0.50, 0.90):
        d.ellipse([w * fx - h * 0.05, h * 0.10 - h * 0.05 - (0 if fx != 0.5 else 0), w * fx + h * 0.05, h * 0.10 + h * 0.05], fill=edge)


def _draw_flower(d, w, h, color, edge):
    cx, cy, r = w * 0.5, h * 0.5, min(w, h) * 0.34
    for i in range(5):
        a = i * 2 * math.pi / 5 - math.pi / 2
        px, py = cx + r * math.cos(a), cy + r * math.sin(a)
        d.ellipse([px - r * 0.62, py - r * 0.62, px + r * 0.62, py + r * 0.62], fill=color, outline=edge, width=2)
    d.ellipse([cx - r * 0.42, cy - r * 0.42, cx + r * 0.42, cy + r * 0.42], fill='#f7e3dc', outline=edge, width=2)


def _draw_glasses(d, w, h, color):
    d.rounded_rectangle([w * 0.04, h * 0.28, w * 0.46, h * 0.74], radius=int(h * 0.2), outline=color, width=4)
    d.rounded_rectangle([w * 0.54, h * 0.28, w * 0.96, h * 0.74], radius=int(h * 0.2), outline=color, width=4)
    d.line([(w * 0.46, h * 0.46), (w * 0.54, h * 0.46)], fill=color, width=4)


def _draw_scarf(d, w, h, color, edge):
    d.rounded_rectangle([w * 0.06, h * 0.20, w * 0.94, h * 0.62], radius=int(h * 0.18), fill=color)
    d.polygon([(w * 0.62, h * 0.55), (w * 0.90, h * 0.92), (w * 0.68, h * 0.95), (w * 0.52, h * 0.62)], fill=color, outline=edge, width=2)
    d.line([(w * 0.10, h * 0.40), (w * 0.90, h * 0.40)], fill=edge, width=3)


def _draw_bell(d, w, h, color, edge):
    d.rounded_rectangle([w * 0.08, h * 0.30, w * 0.92, h * 0.55], radius=int(h * 0.1), fill=color)
    cx, cy = w * 0.5, h * 0.72
    d.pieslice([cx - h * 0.22, cy - h * 0.26, cx + h * 0.22, cy + h * 0.22], 180, 360, fill=edge)
    d.rectangle([cx - h * 0.22, cy - h * 0.02, cx + h * 0.22, cy + h * 0.02], fill=edge)
    d.ellipse([cx - h * 0.05, cy + h * 0.02, cx + h * 0.05, cy + h * 0.12], fill='#1e2a4a')


def _draw_sailor(d, w, h, color, edge):
    d.polygon([(w * 0.08, h * 0.25), (w * 0.92, h * 0.25), (w * 0.72, h * 0.80), (w * 0.28, h * 0.80)], fill=color, outline=edge, width=3)
    d.line([(w * 0.24, h * 0.38), (w * 0.76, h * 0.38)], fill=edge, width=3)
    d.polygon([(w * 0.44, h * 0.55), (w * 0.56, h * 0.55), (w * 0.50, h * 0.72)], fill='#e05555')


def _draw_headphones(d, w, h, color, edge):
    d.arc([w * 0.06, h * 0.10, w * 0.94, h * 1.10], 180, 360, fill=color, width=int(h * 0.09))
    for sx in (0.06, 0.80):
        d.rounded_rectangle([w * sx, h * 0.44, w * sx + w * 0.14, h * 0.86], radius=int(w * 0.05), fill=color, outline=edge, width=3)
        d.ellipse([w * sx + w * 0.035, h * 0.55, w * sx + w * 0.105, h * 0.75], fill=edge)


def _draw_cape(d, w, h, color, edge):
    d.polygon([(w * 0.10, h * 0.22), (w * 0.90, h * 0.22), (w * 0.98, h * 0.95), (w * 0.02, h * 0.95)], fill=color, outline=edge, width=3)
    d.line([(w * 0.12, h * 0.30), (w * 0.88, h * 0.30)], fill=edge, width=3)
    for fx in (0.30, 0.70):
        d.ellipse([w * fx - h * 0.05, h * 0.16, w * fx + h * 0.05, h * 0.26], fill=edge)


_DRAWERS = {
    'ribbon_royal': lambda d, w, h, pal: _draw_bow(d, w, h, pal[0], pal[1]),
    'crown_whale': lambda d, w, h, pal: _draw_crown(d, w, h, pal[0], pal[1]),
    'flower_ocean': lambda d, w, h, pal: _draw_flower(d, w, h, pal[0], pal[1]),
    'glasses_round': lambda d, w, h, pal: _draw_glasses(d, w, h, pal[0]),
    'scarf_navy': lambda d, w, h, pal: _draw_scarf(d, w, h, pal[0], pal[1]),
    'bell_collar': lambda d, w, h, pal: _draw_bell(d, w, h, pal[0], pal[1]),
    'sailor_collar': lambda d, w, h, pal: _draw_sailor(d, w, h, pal[0], pal[1]),
    'headphones': lambda d, w, h, pal: _draw_headphones(d, w, h, pal[0], pal[1]),
    'cape_mini': lambda d, w, h, pal: _draw_cape(d, w, h, pal[0], pal[1]),
}


def render_character(form='semi-chibi', accessory_ids=None, state_image=None, size=None):
    """合成形象：底图（form/state）+ 饰品。返回 RGBA PIL Image。"""
    bm = load_body_model()
    fdef = bm['forms'].get(form) or bm['forms'][bm.get('defaultForm', 'semi-chibi')] if 'defaultForm' in bm else bm['forms']['semi-chibi']
    img_rel = state_image or fdef['image']
    img_path = os.path.join(CHAR_DIR, img_rel.replace('/', os.sep))
    im = Image.open(img_path).convert('RGBA')
    W, H = im.size
    acc_map = {a['id']: a for a in bm['accessories']}
    # 每张图的锚点覆盖（AI 图构图与设定卡不同，逐图标定）
    overrides = (bm.get('anchorOverrides') or {}).get(str(img_rel).replace(os.sep, '/'), {})
    used_slots = set()
    for aid in accessory_ids or []:
        acc = acc_map.get(aid)
        if not acc:
            continue
        slot = acc['slot']
        if slot in used_slots:
            continue  # 同槽位只挂第一件
        used_slots.add(slot)
        base_anchor = fdef['anchors'].get(slot, [0.5, 0.1])
        ax, ay = overrides.get(slot, base_anchor)
        part_w = int(W * acc['scale'])
        aspect = {'glasses_round': 0.55, 'headphones': 1.0, 'scarf_navy': 1.5, 'bell_collar': 2.4,
                  'sailor_collar': 1.4, 'cape_mini': 1.3, 'ribbon_royal': 1.0, 'crown_whale': 1.4, 'flower_ocean': 1.0}.get(aid, 1.0)
        part_h = max(4, int(part_w / aspect))
        part = Image.new('RGBA', (part_w, part_h), (0, 0, 0, 0))
        pd = ImageDraw.Draw(part)
        tex_path = os.path.join(ASSETS, 'accessories', aid + '.png')
        if os.path.exists(tex_path):
            tex = Image.open(tex_path).convert('RGBA')
            tex = tex.resize((part_w, int(tex.height * part_w / tex.width)))
            part.alpha_composite(tex, (0, max(0, (part_h - tex.height) // 2)))
        elif aid in _DRAWERS:
            _DRAWERS[aid](pd, part_w, part_h, acc['palette'])
        # 槽位垂坠：脖挂件从锚点向下坠（而不是以锚点为中心糊在脸上）
        drop = {'neck': 0.45, 'eyes': 0.0, 'head_top': -0.10}.get(slot, 0.0)
        _alpha_composite_at(im, part, ax * W, ay * H + drop * part_h)
    if size:
        im = im.resize(size, Image.LANCZOS)
    return im


if __name__ == '__main__':
    import sys
    form = sys.argv[1] if len(sys.argv) > 1 else 'semi-chibi'
    accs = (sys.argv[2] if len(sys.argv) > 2 else 'ribbon_royal,glasses_round,scarf_navy').split(',')
    out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.environ['TEMP'], 'dressup-preview.png')
    img = render_character(form, accs)
    bg = Image.new('RGB', img.size, (240, 240, 245))
    bg.paste(img, (0, 0), img)
    bg.save(out)
    print(out)
