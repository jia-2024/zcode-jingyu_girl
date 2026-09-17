# -*- coding: utf-8 -*-
"""
鲸鱼娘桌宠 v3：ZCode 软件内的悬浮小鲸鱼（透明气泡 + 输入栏 + 主动行为 + 换装饰品）。

- 跟随 ZCode 窗口（ctypes EnumWindows 找窗 + GetWindowRect，缓存句柄降频轮询）
- 主动行为：待机呼吸 / 沿底边行走（转向翻转）/ 示意跳跃 / 打招呼，昼夜节律
- 透明气泡：半透明 Toplevel，含额度主显示 + 指令输入栏（换装/生成表情包/开关）
- 形象：服务端语境状态 + dressup 饰品合成，图像缓存
数据源 http://127.0.0.1:8787。指令帮助：气泡输入 ? 回车。
"""
import ctypes
import json
import os
import queue
import secrets
import subprocess
import sys
import time
import ctypes.wintypes as wt
import threading
import urllib.error
import urllib.parse
import urllib.request
import tkinter as tk
from PIL import Image, ImageTk

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import dressup  # noqa: E402

PORT = int(os.environ.get('WHALE_PORT', '8787'))
if not 1 <= PORT <= 65535:
    raise SystemExit('WHALE_PORT 必须在 1-65535')
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
ALLOWED_HOST = '127.0.0.1'  # 仅允许本机挂件服务

TRANSPARENT = '#010203'
PET_H = 190
BUBBLE_W, BUBBLE_H = 340, 252
POLL_NET = int(os.environ.get('WHALE_POLL', '3'))

_sr = secrets.SystemRandom()


def rnd(a, b):
    """行为抖动随机（secrets 源）。"""
    return a + (b - a) * (_sr.randrange(1 << 20) / float(1 << 20))


def api_url(path):
    """构造并校验本机挂件服务 URL：仅 http + 127.0.0.1 + 已校验端口，拒绝其它来源数据。"""
    url = f'http://{ALLOWED_HOST}:{PORT}{path}'
    u = urllib.parse.urlparse(url)
    if u.scheme != 'http' or u.hostname != ALLOWED_HOST or u.port != PORT:
        raise ValueError('拒绝非本机请求: ' + url)
    return url


def safe_get_json(path, timeout=6):
    """带边界校验的本机 GET（host 字面量 + 端口断言，防 DNS rebinding）。"""
    return json.load(urllib.request.urlopen(api_url(path), timeout=timeout))


def safe_put_json(path, payload, timeout=8):
    req = urllib.request.Request(api_url(path), method='PUT',
                                 data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def safe_post_json(path, payload, timeout=150):
    req = urllib.request.Request(api_url(path), method='POST',
                                 data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32


def process_name(pid):
    h = kernel32.OpenProcess(0x1000, False, pid)
    if not h:
        return None
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wt.DWORD(512)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value)
    finally:
        kernel32.CloseHandle(h)
    return None


def find_zcode_hwnd():
    res = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            pid = wt.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if 'zcode' in (process_name(pid.value) or '').lower():
                rect = wt.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                if rect.right - rect.left > 500 and rect.bottom - rect.top > 400:
                    res.append((hwnd, rect.left, rect.top, rect.right, rect.bottom))
                    return False
        return True

    user32.EnumWindows(cb, 0)
    return res[0] if res else None


class WhalePet:
    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.attributes('-transparentcolor', TRANSPARENT)
        self.root.configure(bg=TRANSPARENT)
        self.canvas = tk.Canvas(self.root, bg=TRANSPARENT, highlightthickness=0, bd=0)
        self.canvas.pack(fill='both', expand=True)

        self.ctx = {}
        self.catalog = None
        self.q = queue.Queue()
        self.img_cache = {}
        self.cur = None
        self.char_pil = None
        self.char_h = PET_H
        self.bubble_win = None
        self.bubble_until = 0
        self.last_state = None
        self.zwin = None
        self.behavior = 'idle'
        self.behavior_until = time.time() + rnd(3, 8)
        self.walk_dir = _sr.choice((-1, 1))
        self.pos_x = None
        self.pos_y = None
        self._pending_bounce = False

        self.menu = tk.Menu(self.root, tearoff=0, font=('Microsoft YaHei', 10))
        self.pill_win = None      # 额度常显药丸
        self.summon_win = None    # 召唤按钮（贴 ZCode 底边）
        self.summon_pos = None    # 召唤按钮位置（相对 ZCode，可拖拽）
        self.hidden = False       # petOn=False 时的隐藏（缩 1x1，不影响召唤按钮）
        self.canvas.bind('<Button-1>', self.on_press)
        self.canvas.bind('<B1-Motion>', self.on_drag)
        self.canvas.bind('<ButtonRelease-1>', self.on_release)
        self.canvas.bind('<Button-3>', self.on_right)

        threading.Thread(target=self.net_loop, daemon=True).start()
        self.tick()
        self.behave()
        self.root.mainloop()

    # ---------- 网络 ----------
    def net_loop(self):
        while True:
            try:
                ctx = safe_get_json('/api/context-state.json')
                st = safe_get_json('/api/state.json')
                ctx['_settings'] = st.get('state', {})
                self.q.put(ctx)
                if self.catalog is None:
                    self.catalog = safe_get_json('/api/catalog.json', timeout=8)
            except Exception:
                pass
            time.sleep(POLL_NET)

    def drain_ctx(self):
        try:
            while True:
                self.ctx = self.q.get_nowait()
        except queue.Empty:
            pass
        on = (self.ctx.get('_settings') or {}).get('petOn', True)
        if on and self.hidden:
            self.show_pet()
        if not on and not self.hidden:
            self.hide_pet()
        st = self.ctx.get('state')
        if st and st != self.last_state:
            if self.last_state is not None:
                w = self.ctx.get('weather')
                line = (w.get('reminder') + '（' + w.get('text', '') + ' ' + str(w.get('temp', '')) + '°C）') if (w and w.get('ok') and w.get('reminder')) else None
                self.show_bubble(custom_line=line)
            self.last_state = st
            self.behavior = 'gesture'
            self.behavior_until = time.time() + 1.6

    # ---------- 跟窗 ----------
    def tick(self):
        self.drain_ctx()
        z = self.zwin or find_zcode_hwnd()
        if z:
            self.zwin = z
            hwnd, left, top, right, bottom = z
            if user32.IsIconic(hwnd):
                self.hide_pet()
            else:
                on = (self.ctx.get('_settings') or {}).get('petOn', True)
                if not on and not self.hidden:
                    self.hide_pet()
                elif on and self.hidden:
                    self.show_pet()
                pet_w = max(self.root.winfo_width(), 160)
                if self.pos_x is None:
                    self.pos_x = right - left - pet_w - 24
                    self.pos_y = bottom - top - self.char_h - BUBBLE_H - 44
                self.pos_x = min(max(self.pos_x, 0), max(0, right - left - pet_w))
                self.pos_y = min(max(self.pos_y, 0), max(0, bottom - top - self.char_h - 8))
                self.place(left + self.pos_x, top + self.pos_y)
                self.sync_companions(left, top, right, bottom)
        else:
            self.zwin = None
            self.root.deiconify()
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            self.place(sw - 200, sh - self.char_h - 80)
            self.sync_companions(sw - 620, sh - 160, sw, sh)
        self.root.after(700, self.tick)

    # ---------- 显示/隐藏（不用 withdraw：会连带吞掉子窗口的交互） ----------
    def hide_pet(self):
        self.hidden = True
        self.canvas.delete('all')
        self.root.geometry('1x1+5+5')

    def show_pet(self):
        self.hidden = False
        self.cur = None
        self.render_soon()

    # ---------- 常显额度药丸 + 召唤按钮 ----------
    def sync_companions(self, left, top, right, bottom):
        on = (self.ctx.get('_settings') or {}).get('petOn', True)
        # 药丸：贴在形象左侧，常显剩余额度 + 金币
        if self.pill_win is None:
            self.pill_win = tk.Toplevel(self.root)
            self.pill_win.overrideredirect(True)
            self.pill_win.attributes('-topmost', True)
            self.pill_win.attributes('-transparentcolor', TRANSPARENT)
            self.pill_win.attributes('-alpha', 0.88)
            self.pill_win.configure(bg=TRANSPARENT)
            pc = tk.Canvas(self.pill_win, width=170, height=30, bg=TRANSPARENT, highlightthickness=0, bd=0)
            pc.pack()
            pc.create_rectangle(1, 2, 169, 26, fill='#101a30', outline='#3a5aa8', width=2)
            self.pill_text = pc.create_text(85, 14, text='…', font=('Microsoft YaHei', 9, 'bold'), fill='#bcd0ff')
            self.pill_canvas = pc
            self.pill_hidden = False
            pc.bind('<Button-1>', self.toggle_pill)
        q = self.ctx.get('quota') or {}
        if q.get('ok') and q.get('windows'):
            parts = [str(w['label']) + ' ' + str(100 - w['usedPct']) + '%' for w in q.get('windows')[:2]]
            coins = (self.ctx.get('coins') or {}).get('balance')
            txt = ' · '.join(parts)
            if coins is not None:
                txt += ' · 🪙' + str(coins)
            try:
                self.pill_canvas.itemconfigure(self.pill_text, text=txt)
            except Exception:
                pass
        elif self.root.state() == 'normal':
            self.pill_win.deiconify()
        # 召唤按钮：默认贴 ZCode 底边中央（输入栏旁），可拖拽记忆位置
        if self.summon_pos is None:
            self.summon_pos = [(left + right) // 2 - 22, bottom - 58]
        if self.summon_win is None:
            self.summon_win = tk.Toplevel(self.root)
            self.summon_win.overrideredirect(True)
            self.summon_win.attributes('-topmost', True)
            self.summon_win.attributes('-transparentcolor', TRANSPARENT)
            self.summon_win.configure(bg=TRANSPARENT)
            sc = tk.Canvas(self.summon_win, width=44, height=44, bg=TRANSPARENT, highlightthickness=0, bd=0)
            sc.pack()
            sc.create_oval(3, 3, 41, 41, fill='#16224a', outline='#4a5fc0', width=2)
            sc.create_text(22, 21, text='🐋', font=('Segoe UI Emoji', 15), fill='white')
            sc.bind('<ButtonPress-1>', self.summon_press)
            sc.bind('<B1-Motion>', self.summon_drag, add='+')
            sc.bind('<ButtonRelease-1>', self.summon_release, add='+')
            self._summon_btn_canvas = sc
            self.summon_win.geometry('44x44+0+0')
        self.summon_pos[0] = min(max(self.summon_pos[0], 4), max(4, right - left - 48))
        self.summon_pos[1] = min(max(self.summon_pos[1], 4), max(4, bottom - top - 48))
        sx, sy = left + self.summon_pos[0], top + self.summon_pos[1]
        if (int(sx), int(sy)) != (self.summon_win.winfo_x(), self.summon_win.winfo_y()):
            self.summon_win.geometry('44x44+' + str(int(sx)) + '+' + str(int(sy)))
        if self.summon_win.state() != 'normal':
            self.summon_win.deiconify()
        # 药丸贴召唤按钮上方（不遮挡鲸鱼娘）
        px2, py2 = sx - 170 + 6, sy - 36
        self.pill_win.geometry('170x30+' + str(int(px2)) + '+' + str(int(py2)))

    def summon_press(self, e):
        self._sdrag = (e.x_root, e.y_root)
        self._sdrag_moved = False

    def summon_drag(self, e):
        if not getattr(self, '_sdrag', None) or not self.zwin:
            return
        dx, dy = e.x_root - self._sdrag[0], e.y_root - self._sdrag[1]
        if dx or dy:
            self._sdrag_moved = True
            _, l, t, r, b = self.zwin
            self.summon_pos[0] = min(max(self.summon_pos[0] + dx, 4), max(4, r - l - 48))
            self.summon_pos[1] = min(max(self.summon_pos[1] + dy, 4), max(4, b - t - 48))
            self.summon_win.geometry('44x44+' + str(int(l + self.summon_pos[0])) + '+' + str(int(t + self.summon_pos[1])))
            self._sdrag = (e.x_root, e.y_root)

    def summon_release(self, e):
        moved = getattr(self, '_sdrag_moved', False)
        self._sdrag = None
        if not moved:
            self.toggle_pet()

    def toggle_pill(self, e=None):
        self.pill_hidden = not bool((self.ctx.get('_settings') or {}).get('pillHidden', False))
        self.put_state({'pillHidden': self.pill_hidden})
        if self.pill_hidden:
            self.pill_win.withdraw()
        else:
            self.pill_win.deiconify()

    def toggle_pet(self, e=None):
        # 从服务端读最新开关再翻转（不用 6s 轮询的旧缓存，避免连点打架）
        def run():
            try:
                st = safe_get_json('/api/state.json', timeout=5)
                cur = (st.get('state') or {}).get('petOn', True)
                safe_put_json('/api/state.json', {'petOn': not cur})
                ctx = safe_get_json('/api/context-state.json')
                st2 = safe_get_json('/api/state.json')
                ctx['_settings'] = st2.get('state', {})
                self.q.put(ctx)
                if not cur:
                    self.root.after(300, lambda: (self.root.deiconify(), self.show_bubble(custom_line='🐋 召唤成功！我回来啦～')))
            except Exception as e:
                print('TOGGLE error:', e, flush=True)
        threading.Thread(target=run, daemon=True).start()

    def place(self, x, y):
        if (int(x), int(y)) != (self.root.winfo_x(), self.root.winfo_y()):
            self.root.geometry(f'+{int(x)}+{int(y)}')

    # ---------- 主动行为（shimeji 式） ----------
    def behave(self):
        now = time.time()
        # 性格权重（服务端按首启随机固定的性格下发）
        bw = (self.ctx.get('personality') or {}).get('behavior') or {}
        walk_chance = int(bw.get('walkChance', 0.45) * 100)
        if now >= self.behavior_until:
            r = _sr.randrange(100)
            if self.behavior != 'gesture' and r < walk_chance:
                self.behavior = 'walk'
                self.walk_dir = _sr.choice((-1, 1))
                self.behavior_until = now + rnd(*(bw.get('walkDur') or [2, 5]))
            elif self.behavior != 'gesture' and r < walk_chance + 15:
                self.behavior, self.behavior_until = 'gesture', now + 1.5
            else:
                self.behavior, self.behavior_until = 'idle', now + rnd(*(bw.get('idleDur') or [4, 10]))
        eating = self.ctx.get('state') == 'eating' and self.behavior == 'idle'
        if eating:
            # 干饭咀嚼循环：倾斜帧交替 + 上下颠（都是缓存帧/坐标移动，零重采样）
            self.behavior = 'eat'
        elif self.behavior == 'eat' and not eating:
            self.behavior = 'idle'
        if self.behavior == 'eat' and self.zwin:
            tilt = 2 if int(time.time() * 3) % 2 == 0 else -2
            key = self._eat_key(tilt)
            bounce = bool(int(time.time() * 3) % 2)
            self.render_keyed(key, bounce)
            self.root.after(330, self.behave)
            return
        if self.behavior == 'walk' and self.zwin:
            step = self.walk_dir * 3
            self.pos_x += step
            hwnd, left, top, right, bottom = self.zwin
            pet_w = max(self.root.winfo_width(), 160)
            if self.pos_x < 4 or self.pos_x > right - left - pet_w - 4:
                self.walk_dir *= -1
            self.place(left + self.pos_x, top + self.pos_y)
            self.render_soon()
        elif self.behavior == 'gesture':
            self.render_soon(bounce=(int(time.time() * 6) % 2 == 0))
        self.root.after(200 if self.behavior == 'walk' else 500, self.behave)

    # ---------- 渲染（缓存 + 变化才重绘） ----------
    def render_soon(self, bounce=False):
        self._pending_bounce = bounce
        self.root.after(1, self.render_now)

    def _eat_key(self, tilt):
        ctx = self.ctx
        rel = (ctx.get('imageUrl') or '').split('/api/assets/')[-1].split('?')[0]
        accs = tuple(sorted((ctx.get('_settings') or {}).get('accessories') or []))
        h = int(PET_H * float((ctx.get('_settings') or {}).get('petScale', 1.0)))
        return (rel, h, self.walk_dir < 0, accs, tilt)

    def _render_entry(self, rel, h, flip, accs, tilt):
        entry = self.img_cache.get((rel, h, flip, accs, tilt))
        if entry:
            return entry
        base = self.img_cache.get((rel, h, flip, accs, 0))
        if tilt != 0 and base:
            im = base[0].rotate(tilt, Image.NEAREST, expand=False)
            entry = (im, ImageTk.PhotoImage(im))
        else:
            try:
                prefix = 'characters/deepseek/'
                char_rel = rel[len(prefix):] if rel.startswith(prefix) else rel
                im = dressup.render_character(
                    form=(self.ctx.get('_settings') or {}).get('form', 'semi-chibi'),
                    accessory_ids=accs,
                    state_image=char_rel.replace('/', os.sep))
            except Exception as e:
                print('dressup fallback:', e, flush=True)
                im = Image.open(os.path.join(ASSETS, rel.replace('/', os.sep))).convert('RGBA')
            w0, h0 = im.size
            im = im.resize((max(1, int(w0 * h / h0)), h), Image.LANCZOS)
            if flip:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            entry = (im, ImageTk.PhotoImage(im))
            if tilt == 0:
                self.img_cache[(rel, h, flip, accs, 0)] = entry
        if len(self.img_cache) > 40:
            self.img_cache.pop(next(iter(self.img_cache)))
        self.img_cache[(rel, h, flip, accs, tilt)] = entry
        return entry

    def render_keyed(self, key, bounce=False):
        rel, h, flip, accs, tilt = key
        if key == self.cur:
            self.canvas.coords('char', 0, 6 if bounce else 0)
            return
        self.cur = key
        try:
            entry = self._render_entry(rel, h, flip, accs, tilt)
            self.char_pil = entry[0]
            self.char_h = entry[0].height
            want = f'{max(entry[0].width, 160)}x{self.char_h + 8}'
            if self.root.geometry().split('+')[0] != want:
                self.root.geometry(want)
            self.canvas.delete('char')
            self.canvas.create_image(0, 6 if bounce else 0, image=entry[1], anchor='nw', tags='char')
            self._cur_photo = entry[1]
        except Exception as e:
            print('render error:', e, flush=True)

    def render_now(self):
        ctx = self.ctx
        if not ctx or not ctx.get('imageUrl'):
            return
        rel = ctx['imageUrl'].split('/api/assets/')[-1].split('?')[0]
        accs = tuple(sorted((ctx.get('_settings') or {}).get('accessories') or []))
        h = int(PET_H * float((ctx.get('_settings') or {}).get('petScale', 1.0)))
        flip = self.walk_dir < 0
        # 行走摇摆帧（骨骼式变换）：走动时按步频交替 ±4° 倾斜，旋转帧复用缓存
        tilt = 0
        if self.behavior == 'walk':
            tilt = 4 if int(time.time() * 4) % 2 == 0 else -4
        key = (rel, h, flip, accs, tilt)
        bounce = self._pending_bounce
        self._pending_bounce = False
        if key == self.cur:
            # 同一形象：跳动只挪画布项（避免 166ms 一次的 LANCZOS 重采样卡顿）
            self.canvas.coords('char', 0, 6 if bounce else 0)
            return
        self.cur = key
        try:
            entry = self.img_cache.get(key)
            if not entry:
                base_key = (rel, h, flip, accs, 0)
                base = self.img_cache.get(base_key)
                if tilt != 0 and base:
                    im = base[0].rotate(tilt, Image.NEAREST, expand=False)
                    entry = (im, ImageTk.PhotoImage(im))
                else:
                    try:
                        # imageUrl 相对 assets/；dressup 期望相对 characters/deepseek/
                        prefix = 'characters/deepseek/'
                        char_rel = rel[len(prefix):] if rel.startswith(prefix) else rel
                        im = dressup.render_character(
                            form=(ctx.get('_settings') or {}).get('form', 'semi-chibi'),
                            accessory_ids=accs,
                            state_image=char_rel.replace('/', os.sep))
                    except Exception as e:
                        print('dressup fallback:', e, flush=True)
                        im = Image.open(os.path.join(ASSETS, rel.replace('/', os.sep))).convert('RGBA')
                    w0, h0 = im.size
                    im = im.resize((max(1, int(w0 * h / h0)), h), Image.LANCZOS)
                    if flip:
                        im = im.transpose(Image.FLIP_LEFT_RIGHT)
                    entry = (im, ImageTk.PhotoImage(im))
                    if tilt == 0:
                        self.img_cache[base_key] = entry
                if len(self.img_cache) > 40:
                    self.img_cache.pop(next(iter(self.img_cache)))
                self.img_cache[key] = entry
            self.char_h = entry[0].height
            self.root.geometry(f'{max(entry[0].width, 160)}x{self.char_h + 8}')
            self.canvas.delete('char')
            self.canvas.create_image(0, 6 if bounce else 0, image=entry[1], anchor='nw', tags='char')
            self._cur_photo = entry[1]
        except Exception:
            pass

    # ---------- 透明气泡 + 输入栏 ----------
    def show_bubble(self, custom_line=None):
        ctx = self.ctx
        if not ctx:
            return
        if self.bubble_win:
            try: self.bubble_win.destroy()
            except Exception: pass
            self.bubble_win = None

        win = tk.Toplevel(self.root)
        win.overrideredirect(True)
        win.attributes('-topmost', True)
        win.attributes('-transparentcolor', TRANSPARENT)
        win.attributes('-alpha', 0.92)
        win.configure(bg=TRANSPARENT)
        c = tk.Canvas(win, bg=TRANSPARENT, highlightthickness=0, bd=0)
        c.pack(fill='both', expand=True)
        H = BUBBLE_H

        c.create_rectangle(4, 2, BUBBLE_W - 4, H - 26, fill='#eef2fb', outline='')
        c.create_rectangle(4, 2, BUBBLE_W - 4, H - 26, fill='', outline='#203170', width=2)
        c.create_polygon(BUBBLE_W - 52, H - 27, BUBBLE_W - 16, H - 27, BUBBLE_W - 44, H + 2, fill='#eef2fb', outline='')

        ty = 10
        q = ctx.get('quota') or {}
        if q.get('ok') and q.get('windows'):
            for w in q.get('windows'):
                reset = ''
                if w.get('resetsAt'):
                    sec = max(0, int((w['resetsAt'] / 1000) - time.time()))
                    reset = f"，{sec // 3600}时{(sec % 3600) // 60}分后重置" if sec < 172800 else f"，{sec // 86400}天后重置"
                c.create_text(BUBBLE_W // 2, ty, text=f"{w['label']}窗口 剩 {100 - w['usedPct']}%" + reset,
                              anchor='n', font=('Microsoft YaHei', 10, 'bold'), fill='#203170')
                ty += 20
        bal = ctx.get('balance')
        if bal and bal.get('totalBalance') is not None:
            c.create_text(BUBBLE_W // 2, ty, text=f"DeepSeek ¥{bal['totalBalance']:.2f} · 今日 ¥{ctx.get('todayUsage', 0):.2f}",
                          anchor='n', font=('Microsoft YaHei', 9), fill='#7a8bb8')
            ty += 18
        else:
            c.create_text(BUBBLE_W // 2, ty, text='DeepSeek 余额获取中…', anchor='n',
                          font=('Microsoft YaHei', 9), fill='#9fb0d9')
            ty += 18
        meme_url = ctx.get('memeUrl')
        if meme_url:
            rel = meme_url.split('/api/assets/')[-1]
            try:
                mim = Image.open(os.path.join(ASSETS, rel.replace('/', os.sep))).convert('RGBA')
                mim.thumbnail((BUBBLE_W - 40, 96), Image.LANCZOS)
                self._bubble_meme_img = ImageTk.PhotoImage(mim)
                c.create_image(BUBBLE_W // 2, ty + 4, image=self._bubble_meme_img, anchor='n')
                ty += mim.height + 8
            except Exception:
                pass
        c.create_text(BUBBLE_W // 2, ty, text=custom_line or ctx.get('line', ''), anchor='n', justify='center',
                      font=('Microsoft YaHei', 9), fill='#4a5fc0', width=BUBBLE_W - 30)

        # 输入栏：指令 + 开关（发送/回车执行）
        bar = tk.Frame(win, bg='#dfe7f8')
        bar.place(x=8, y=H - 26, width=BUBBLE_W - 16, height=20)
        entry = tk.Entry(bar, bd=0, bg='#ffffff', fg='#203170', font=('Microsoft YaHei', 9))
        entry.pack(side='left', fill='both', expand=True, padx=(2, 1), pady=1)
        btn = tk.Button(bar, text='发送', bd=0, bg='#4a5fc0', fg='white', font=('Microsoft YaHei', 8),
                        activebackground='#7a8ff0', command=lambda: self.run_command(entry))
        btn.pack(side='right', fill='both', padx=(1, 2), pady=1)
        entry.bind('<Return>', lambda e: self.run_command(entry))
        entry.focus_set()

        px, py = self.root.winfo_x(), self.root.winfo_y()
        pw = max(self.root.winfo_width(), BUBBLE_W)
        x = px + pw - BUBBLE_W
        y = py - H + 8
        if self.zwin:
            _, l, t, r, b = self.zwin
            if y < t + 4:
                y = py + self.root.winfo_height() + 4
            x = min(max(x, l + 4), r - BUBBLE_W - 4)
        # 关闭按钮 ✕（右上角）
        c.create_text(BUBBLE_W - 16, 10, text='✕', font=('Microsoft YaHei', 10, 'bold'), fill='#9fb0d9',
                      tags='closebtn')
        c.tag_bind('closebtn', '<Button-1>', lambda e: self.close_bubble())
        c.tag_bind('closebtn', '<Enter>', lambda e: c.config(cursor='hand2'))
        win.geometry(f'{BUBBLE_W}x{H}+{int(x)}+{int(y)}')
        self.bubble_win = win
        self.bubble_until = time.time() + 90

        gen = (setattr(self, '_bubble_gen', getattr(self, '_bubble_gen', 0) + 1) or self._bubble_gen)
        def auto_close(g=gen):
            # 代币校验：气泡换代/销毁后链路自动终止（修复定时器泄漏=越用越卡）
            if self.bubble_win is not win or g != getattr(self, '_bubble_gen', 0):
                return
            focused = False
            try:
                focused = win.focus_get() is not None
            except Exception:
                pass
            hover = getattr(self, '_bubble_hover', False)
            if not focused and not hover and time.time() > self.bubble_until:
                try: win.destroy()
                except Exception: pass
                if self.bubble_win is win: self.bubble_win = None
                return
            self.root.after(1000, lambda: auto_close(g))
        self.root.after(1000, lambda: auto_close(gen))

    def close_bubble(self):
        if self.bubble_win:
            try: self.bubble_win.destroy()
            except Exception: pass
            self.bubble_win = None

    # ---------- 指令解析 ----------
    def run_command(self, entry):
        text = (entry.get() or '').strip()
        entry.delete(0, 'end')
        if not text:
            return
        low = text.lower()

        def put(patch, note=None):
            self.put_state(patch)
            self.show_bubble(custom_line=note or '好啦好啦，马上换！')

        if low in ('?', '？', 'help'):
            self.show_bubble(custom_line='指令：换装 女仆|白饭|表情包|原版 · 形态 标准|紧凑|半q|q|sd · 饰品 皇冠/眼镜/围巾/铃铛/斗篷/花 · 生成 <描述> · 关闭鲸鱼娘 · 自动')
        elif ('关闭' in text or '开启' in text) and ('鲸' in text or '桌宠' in text or '娘' in text):
            on = '开启' in text
            self.put_state({'petOn': on})
            (self.root.deiconify if on else self.root.withdraw)()
            if on:
                self.show_bubble(custom_line='我回来啦～')
        elif text.startswith('生成') or text.startswith('画'):
            prompt = text[2:].strip() or '开心地跳起来'
            self.show_bubble(custom_line='在画了，等人家 10~30 秒……')
            threading.Thread(target=self.gen_meme, args=(prompt,), daemon=True).start()
        elif low.startswith('形态') or low.startswith('form'):
            v = text.split(None, 1)[-1].strip()
            alias = {'sd': 'super-deformed', '标准': 'standard', '紧凑': 'compact', '半q': 'semi-chibi', 'q': 'chibi'}
            put({'form': alias.get(v, v)}, f'变成 {v}！')
        elif '换装' in text:
            v = text.replace('换装', '').strip()
            alias = {'女仆': 'maid', '白饭': 'rice', '吃饭': 'rice', '表情包': 'sticker', '贴纸': 'sticker', '原版': 'classic', '鲸鱼': 'classic'}
            put({'outfit': alias.get(v, v)}, f'换上 {v}！')
        elif low.startswith('饰品'):
            v = text[2:].strip()
            amap = {'皇冠': 'crown_whale', '眼镜': 'glasses_round', '围巾': 'scarf_navy', '铃铛': 'bell_collar',
                    '斗篷': 'cape_mini', '花': 'flower_ocean', '结': 'ribbon_royal', '耳机': 'headphones'}
            if v in ('关闭', '摘', '摘掉'):
                put({'accessories': []}, '饰品都摘掉啦')
            elif v in amap:
                cur = list((self.ctx.get('_settings') or {}).get('accessories') or [])
                if amap[v] in cur:
                    cur.remove(amap[v])
                    note = f'摘掉{v}'
                else:
                    cur.append(amap[v])
                    note = f'戴上{v}！'
                put({'accessories': cur}, note)
            else:
                self.show_bubble(custom_line='饰品：皇冠/眼镜/围巾/铃铛/斗篷/花/结/耳机（再说一次摘掉）')
        elif '自动' in text:
            put({'manual': False, 'manualState': None}, '回到自动语境～')
        else:
            self.send_chat(text)

    def send_chat(self, text):
        self.show_bubble(custom_line='（' + text[:18] + '）……思考中')
        def run():
            try:
                r = safe_post_json('/api/chat', {'text': text}, timeout=40)
                reply = r.get('reply') or r.get('fallback') or '……'
                meme = r.get('memeUrl')
                if meme:
                    rel = meme.split('/api/assets/')[-1]
                    self._chat_meme = rel  # 让气泡直接展示这张表情包
                    self.show_bubble_meme(rel, reply)
                else:
                    self.show_bubble(custom_line=reply)
            except Exception as e:
                self.show_bubble(custom_line='（断线了：' + str(e)[:30] + '）')
        threading.Thread(target=run, daemon=True).start()

    def show_bubble_meme(self, rel, caption):
        # 聊天表情包：与语境气泡同一尺寸体系（140×92），不再用独立小图
        try:
            self.show_bubble(custom_line=caption)
            if self.bubble_win:
                mim = Image.open(os.path.join(ASSETS, rel.replace('/', os.sep))).convert('RGBA')
                mim.thumbnail((140, 92), Image.LANCZOS)
                self._chat_meme_img = ImageTk.PhotoImage(mim)
                wc = self.bubble_win.winfo_children()[0]
                wc.create_image(80, 56, image=self._chat_meme_img)
        except Exception:
            pass

    def gen_meme(self, prompt):
        try:
            r = safe_post_json('/api/meme/generate', {'prompt': prompt})
            if r.get('ok'):
                self.show_bubble(custom_line='画好了！已存入表情包库，去控制台看看～')
            else:
                self.show_bubble(custom_line='画砸了：' + r.get('error', '')[:40])
        except Exception as e:
            self.show_bubble(custom_line='画砸了：' + str(e)[:40])

    def put_state(self, patch):
        def run():
            try:
                safe_post_json('/api/state.json', patch)
                ctx = safe_get_json('/api/context-state.json')
                st = safe_get_json('/api/state.json')
                ctx['_settings'] = st.get('state', {})
                self.q.put(ctx)
                self.cur = None
            except Exception:
                pass
        threading.Thread(target=run, daemon=True).start()

    # ---------- 交互 ----------
    def on_press(self, e):
        self.drag = (e.x, e.y)
        self.drag_start = (e.x, e.y)
        self.press_at = time.time()
        self.moved = False
        self.behavior = 'idle'
        # Q 弹第 1 帧：压扁
        if self.char_pil:
            frames = self._q_frames()
            if frames:
                img, yoff = frames[0]
                self.canvas.delete('char')
                self.canvas.create_image(int(self.char_pil.width * -0.06), BUBBLE_H + yoff, image=img, anchor='nw', tags='char')

    def _q_frames(self):
        # Q 弹三帧：压扁 / 拉伸 / 回弹（按当前形象缓存）
        if not self.char_pil:
            return []
        w0, h0 = self.char_pil.size
        specs = [((int(w0 * 1.12), int(h0 * 0.82)), int(h0 * 0.18)),
                 ((int(w0 * 0.94), int(h0 * 1.08)), 0),
                 ((int(w0 * 1.05), int(h0 * 0.96)), 0)]
        out = []
        for i, ((w, h), yoff) in enumerate(specs):
            k = (self.cur, 'q', i)
            f = self.img_cache.get(k)
            if not f:
                im = self.char_pil.resize((w, h), Image.LANCZOS)
                f = (im, ImageTk.PhotoImage(im))
                self.img_cache[k] = f
            out.append((f[1], yoff))
        return out

    def play_q_then(self, delay_ms, then=None):
        frames = self._q_frames()
        if not frames:
            if then: self.root.after(delay_ms, then)
            return
        def step(i):
            if i >= len(frames):
                self.canvas.delete('char')
                self.render_soon()
                if then: self.root.after(60, then)
                return
            img, yoff = frames[i]
            self.canvas.delete('char')
            self.canvas.create_image(int(self.char_pil.width * (0.06 - 0.06 * i)), BUBBLE_H + yoff, image=img, anchor='nw', tags='char')
            self.root.after(95, lambda: step(i + 1))
        self.root.after(delay_ms, lambda: step(0))

    def on_drag(self, e):
        if not self.drag:
            return
        dx, dy = e.x - self.drag[0], e.y - self.drag[1]
        if dx or dy:
            if abs(e.x - self.drag_start[0]) + abs(e.y - self.drag_start[1]) > 3:
                self.moved = True
            self.root.geometry(f'+{self.root.winfo_x() + dx}+{self.root.winfo_y() + dy}')
            self.drag = (e.x, e.y)

    def on_release(self, e):
        was_click = (time.time() - self.press_at) < 0.35 and not self.moved
        self.drag = None
        if self.zwin and self.moved:
            _, l, t, r, b = self.zwin
            self.pos_x = self.root.winfo_x() - l
            self.pos_y = self.root.winfo_y() - t
        if was_click:
            self.behavior = 'gesture'
            self.behavior_until = time.time() + 1.4
            # 先播完整 Q 弹序列，气泡随后弹出（不再盖住弹跳动画）
            self.play_q_then(260, self.show_bubble)

    def on_right(self, e):
        self.menu.delete(0, 'end')
        # 四轴菜单：画风 / 比例 / 形态状态（由资产目录动态生成，无立绘组合不出现）
        cat = self.catalog
        cur_style = (self.ctx.get('style') or {}).get('id')
        cur_prop = (self.ctx.get('proportion') or {}).get('id')
        if cat:
            names = cat.get('stateNames', {})
            sm = tk.Menu(self.menu, tearoff=0, font=('Microsoft YaHei', 10))
            for x in cat['styles']:
                sm.add_command(label=('✔ ' if x['id'] == cur_style else '    ') + x['name'],
                               command=lambda sid=x['id'], first=x['proportions'][0]['id']: self.put_state({'style': sid, 'proportion': first}))
            self.menu.add_cascade(label='画风', menu=sm)
            sd = next((x for x in cat['styles'] if x['id'] == cur_style), cat['styles'][0])
            pm = tk.Menu(self.menu, tearoff=0, font=('Microsoft YaHei', 10))
            for x in sd['proportions']:
                pm.add_command(label=('✔ ' if x['id'] == cur_prop else '    ') + x['name'],
                               command=lambda sid=sd['id'], pid=x['id']: self.put_state({'style': sid, 'proportion': pid}))
            self.menu.add_cascade(label='比例', menu=pm)
            prop_def = next((x for x in sd['proportions'] if x['id'] == cur_prop), sd['proportions'][0])
            tm = tk.Menu(self.menu, tearoff=0, font=('Microsoft YaHei', 10))
            for sid in prop_def.get('states', {}):
                tm.add_command(label=('✔ ' if (self.ctx.get('_settings') or {}).get('manualState') == sid else '    ') + names.get(sid, sid),
                               command=lambda x=sid: self.put_state({'manual': True, 'manualState': x}))
            self.menu.add_cascade(label='形态（状态）', menu=tm)
        am = tk.Menu(self.menu, tearoff=0, font=('Microsoft YaHei', 10))
        accs = (self.ctx.get('_settings') or {}).get('accessories') or []
        for aid, name in [('crown_whale', '皇冠'), ('ribbon_royal', '缎带结'), ('flower_ocean', '海蓝花'),
                          ('glasses_round', '眼镜'), ('scarf_navy', '围巾'), ('bell_collar', '铃铛'),
                          ('sailor_collar', '水手领'), ('headphones', '耳机'), ('cape_mini', '斗篷')]:
            am.add_command(label=('✔ ' if aid in accs else '    ') + name,
                           command=lambda a=aid: self.toggle_acc(a))
        self.menu.add_cascade(label='饰品', menu=am)
        self.menu.add_command(label='🌍 自动语境：' + ('开' if not (self.ctx.get('_settings') or {}).get('manual') else '关'),
                              command=lambda: self.put_state({'manual': False}))
        self.menu.add_command(label='🎭 表情包气泡：' + ('开' if (self.ctx.get('_settings') or {}).get('memeBubbles', True) else '关'),
                              command=lambda: self.put_state({'memeBubbles': not (self.ctx.get('_settings') or {}).get('memeBubbles', True)}))
        self.menu.add_separator()
        sm = tk.Menu(self.menu, tearoff=0, font=('Microsoft YaHei', 10))
        coins = (self.ctx.get('coins') or {}).get('balance', '?')
        sm.add_command(label='🪙 金币 ' + str(coins) + '（聊天消费就攒）', state='disabled')
        sm.add_separator()
        for item in self.shop_items():
            owned = item['id'] in ((self.ctx.get('coins') or {}).get('owned') or [])
            label = ('✔ ' if owned else '') + item['name'] + '（' + str(item['price']) + '🪙）'
            sm.add_command(label=label, command=lambda i=item: self.buy_item(i))
        self.menu.add_cascade(label='🛒 商店', menu=sm)
        self.menu.add_command(label='📒 控制台', command=self.open_console)
        self.menu.add_command(label='🚪 退出', command=self.root.destroy)
        try:
            self.menu.tk_popup(e.x_root, e.y_root)
        finally:
            self.menu.grab_release()

    def shop_items(self):
        try:
            r = safe_get_json('/api/shop.json', timeout=5)
            return [i for i in r.get('items', []) if i.get('price', 0) > 0]
        except Exception:
            return []

    def buy_item(self, item):
        def run():
            try:
                r = safe_post_json('/api/shop/buy', {'itemId': item['id']}, timeout=8)
                if r.get('ok'):
                    line = '买到 ' + item['name'] + ' 啦！'
                else:
                    line = r.get('error', '买失败')
                self.show_bubble(custom_line=line)
                ctx = safe_get_json('/api/context-state.json')
                st = safe_get_json('/api/state.json')
                ctx['_settings'] = st.get('state', {})
                self.q.put(ctx)
            except Exception as e:
                self.show_bubble(custom_line='商店打了个盹：' + str(e)[:30])
        threading.Thread(target=run, daemon=True).start()

    def toggle_acc(self, aid):
        cur = list((self.ctx.get('_settings') or {}).get('accessories') or [])
        if aid in cur:
            cur.remove(aid)
        else:
            cur.append(aid)
        self.put_state({'accessories': cur})

    def open_console(self):
        subprocess.run(['cmd', '/c', 'start', '', 'msedge', '--app=' + api_url('/')], shell=False, check=False)


if __name__ == '__main__':
    WhalePet()
