# 素材预处理：白底参考图 → 透明 cut-out PNG
# 用边缘泛洪（flood fill）而不是全局白色替换：保护女仆装/围裙内部的白色。
# 输入: sources/whalechan 参考图 + zhihu 白底图；输出: assets/characters/deepseek/...
import os
from collections import deque
from PIL import Image

SRC = r'I:\allai_work\z\plugin\sources'
OUT = r'I:\allai_work\z\plugin\tools\zcode-balance-whale\assets\characters\deepseek'

# (源文件相对 sources 目录, 输出相对 characters/deepseek 目录)
JOBS = [
    # whalechan 五形态参考（form/state 语义映射见 manifest）
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\standard\01_gentle_wave.webp', r'forms\standard\idle.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\standard\03_light_turning_step.webp', r'forms\standard\working.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\standard\05_side_reclining_pose.webp', r'forms\standard\rest.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\compact\0102_intimate_relationship_question_rendered_isolated.webp', r'forms\compact\idle.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\compact\04_light_turn.webp', r'forms\compact\working.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\compact\0080_lounging_on_chair_rendered_isolated.webp', r'forms\compact\rest.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\semi-chibi\0092_enduring_release_delay_rendered_isolated.webp', r'forms\semi-chibi\alert.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\semi-chibi\0015_data_still_in_brain_rendered_isolated.webp', r'forms\semi-chibi\thinking.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\semi-chibi\0076_sitting_ready_on_chair_rendered_isolated.webp', r'forms\semi-chibi\working.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\chibi\0067_angry_you_are_silly_reply_rendered_isolated.webp', r'forms\chibi\angry.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\chibi\0054_rice_identity_comic_rendered_isolated.webp', r'forms\chibi\eating.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\chibi\0057_patting_full_belly_rendered_isolated.webp', r'forms\chibi\happy.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\super-deformed\0019_literal_love_reply_rendered_isolated.webp', r'forms\super-deformed\happy.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\super-deformed\0040_kicked_from_chair_rendered_isolated.webp', r'forms\super-deformed\error.png'),
    (r'whalechan\skills\whalechan-image-character\assets\reference-images\super-deformed\0081_stranded_on_floor_rendered_isolated.webp', r'forms\super-deformed\sad.png'),
    # zhihu 白饭特写（吃饭状态主图）
    (r'tools\zcode-balance-whale\assets\state-deepseek-rice-sit.webp', r'states\rice-sit.png'),
    (r'tools\zcode-balance-whale\assets\state-deepseek-rice-kneel.webp', r'states\rice-kneel.png'),
]

TOLERANCE = 34  # 与边缘白点的最大色差

def white_to_alpha(im):
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    # 底色基准：四角中位色（whalechan 默认底是米白 #F5EADD，不一定是纯白）
    corners = [px[0, 0], px[w-1, 0], px[0, h-1], px[w-1, h-1]]
    base = tuple(sorted(c[i] for c in corners)[1] for i in range(3))
    def near_bg(p):
        return abs(p[0]-base[0]) <= TOLERANCE and abs(p[1]-base[1]) <= TOLERANCE and abs(p[2]-base[2]) <= TOLERANCE
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_bg(px[x, y]) and not seen[y * w + x]:
                q.append((x, y)); seen[y * w + x] = 1
    for y in range(h):
        for x in (0, w - 1):
            if near_bg(px[x, y]) and not seen[y * w + x]:
                q.append((x, y)); seen[y * w + x] = 1
    while q:
        x, y = q.popleft()
        p = px[x, y]
        px[x, y] = (p[0], p[1], p[2], 0)
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and near_bg(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return im

def autocrop(im, pad=8):
    bbox = im.getchannel('A').getbbox()
    if not bbox: return im
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(im.width, r + pad); b = min(im.height, b + pad)
    return im.crop((l, t, r, b))

for src, dst in JOBS:
    if src.startswith('tools'):
        sp = os.path.normpath(os.path.join(SRC, '..', src))
    else:
        sp = os.path.normpath(os.path.join(SRC, src))
    dp = os.path.normpath(os.path.join(OUT, dst))
    os.makedirs(os.path.dirname(dp), exist_ok=True)
    im = Image.open(sp)
    im = white_to_alpha(im)
    im = autocrop(im)
    im.save(dp)
    print(f'{dst}: {im.size}')
print('done')
