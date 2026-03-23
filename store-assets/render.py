"""
Render all PagePulse Chrome Web Store assets using Pillow.
Generates: icon, 4 screenshots, 3 promo tiles.
"""
from PIL import Image, ImageDraw, ImageFont
import os, math

OUT = os.path.dirname(os.path.abspath(__file__))
ICONS = os.path.join(os.path.dirname(OUT), "icons")

# ─── Colors ───
EMERALD = (16, 185, 129)
EMERALD_DARK = (13, 150, 104)
EMERALD_DEEPER = (10, 123, 85)
BG_ROOT = (6, 8, 15)
BG_CANVAS = (10, 14, 26)
BG_SURFACE = (17, 24, 39)
BG_RAISED = (26, 31, 46)
BG_ELEVATED = (35, 40, 56)
WHITE = (255, 255, 255)
TEXT_PRI = (243, 244, 246)
TEXT_SEC = (156, 163, 175)
TEXT_TER = (107, 114, 128)
RED = (239, 68, 68)
RED_TEXT = (252, 165, 165)
AMBER = (245, 158, 11)
BLUE_HL = (37, 99, 235)
GREEN_OK = (5, 150, 105)
DIFF_ADD_BG = (10, 61, 46)
DIFF_DEL_BG = (61, 26, 26)
DIFF_ADD_TEXT = (110, 231, 183)
DIFF_DEL_TEXT = (252, 165, 165)
PAGE_BG = (243, 244, 246)
CARD_BG = (255, 255, 255)
CARD_BORDER = (229, 231, 235)
NOTIF_BG = (28, 28, 30)

def try_font(size, bold=False):
    """Try to load a good font, fallback gracefully."""
    names = [
        "/System/Library/Fonts/SFNSText.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    if bold:
        names = [
            "/System/Library/Fonts/SFNSText-Bold.otf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ] + names
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except:
            pass
    return ImageFont.load_default()

def try_mono(size):
    names = [
        "/System/Library/Fonts/SFMono-Regular.otf",
        "/System/Library/Fonts/Menlo.ttc",
        "/System/Library/Fonts/Supplemental/Courier New.ttf",
    ]
    for n in names:
        try:
            return ImageFont.truetype(n, size)
        except:
            pass
    return ImageFont.load_default()

# ─── Drawing Helpers ───
def rounded_rect(draw, xy, radius, fill, outline=None):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline)

def draw_pulse(draw, cx, cy, w, h, color=WHITE, thickness=2):
    points = [
        (-0.42, 0.0), (-0.18, 0.0),
        (-0.11, -0.12), (-0.08, 0.0),
        (-0.04, -0.40), (0.0, 0.02), (0.04, 0.28),
        (0.08, 0.0), (0.12, -0.10), (0.15, 0.0),
        (0.18, 0.0), (0.42, 0.0),
    ]
    px = [(int(cx + p[0]*w), int(cy + p[1]*h)) for p in points]
    for i in range(len(px)-1):
        draw.line([px[i], px[i+1]], fill=color, width=thickness)

def draw_status_dot(draw, cx, cy, r, color):
    # Glow
    for gr in range(r*3, r, -1):
        a = max(0, 40 - (gr - r) * 8)
        gc = tuple(min(255, c + 60) for c in color) + (a,)
        draw.ellipse([cx-gr, cy-gr, cx+gr, cy+gr], fill=gc)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color)

def overlay_blend(base, overlay_color, alpha):
    """Simple color blend"""
    r = int(base[0] * (1-alpha) + overlay_color[0] * alpha)
    g = int(base[1] * (1-alpha) + overlay_color[1] * alpha)
    b = int(base[2] * (1-alpha) + overlay_color[2] * alpha)
    return (r, g, b)


# ═══════════════════════════════════════
# ICON
# ═══════════════════════════════════════
def make_icon(size):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    m = int(size * 0.06)
    cr = int(size * 0.22)
    # Gradient background (approximate with bands)
    for y in range(m, size-m):
        t = (y - m) / (size - 2*m)
        r = int(20 * (1-t) + 10 * t)
        g = int(209 * (1-t) + 123 * t)
        b = int(148 * (1-t) + 85 * t)
        draw.line([(m, y), (size-m-1, y)], fill=(r, g, b))
    # Apply rounded corners by masking
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([m, m, size-m, size-m], radius=cr, fill=255)
    img.putalpha(mask)
    # Redraw with mask
    final = Image.new("RGBA", (size, size), (0,0,0,0))
    final.paste(img, mask=img)
    draw = ImageDraw.Draw(final)
    # Pulse line
    th = max(2, int(size * 0.055))
    draw_pulse(draw, size//2, size//2, int(size*0.8), int(size*0.55), WHITE, th)
    # Highlight
    for x in range(m, size-m):
        for y in range(m, min(m + int((size-2*m)*0.3), size-m)):
            px = final.getpixel((x, y))
            if px[3] > 0:
                t2 = 1 - (y - m) / ((size-2*m)*0.3)
                a = int(t2 * 30)
                nr = min(255, px[0] + a)
                ng = min(255, px[1] + a)
                nb = min(255, px[2] + a)
                final.putpixel((x, y), (nr, ng, nb, px[3]))
    return final


# ═══════════════════════════════════════
# SCREENSHOT 1: POPUP
# ═══════════════════════════════════════
def make_ss_popup():
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), PAGE_BG)
    draw = ImageDraw.Draw(img)
    f14b = try_font(14, bold=True)
    f12 = try_font(12)
    f13 = try_font(13)
    f13b = try_font(13, bold=True)
    f11 = try_font(11)
    f10 = try_font(10)
    fm11 = try_mono(11)
    fm10 = try_mono(10)

    # Browser chrome
    draw.rectangle([0, 0, W, 43], fill=(229, 231, 235))
    draw.ellipse([14, 16, 24, 26], fill=(239, 68, 68))
    draw.ellipse([30, 16, 40, 26], fill=(245, 158, 11))
    draw.ellipse([46, 16, 56, 26], fill=(34, 197, 94))
    rounded_rect(draw, [74, 10, 580, 34], 6, CARD_BG)
    draw.text((84, 14), "books.toscrape.com/catalogue", fill=TEXT_TER, font=fm11)

    # Page content - cards
    for i, (y, h2) in enumerate([(70, 160), (250, 200), (470, 140)]):
        rounded_rect(draw, [60, y, W-60, y+h2], 12, CARD_BG)
        rounded_rect(draw, [84, y+20, 350, y+34], 3, (209, 213, 219))
        for j in range(3):
            w2 = [0.7, 0.55, 0.35][j]
            rounded_rect(draw, [84, y+46+j*18, int(84+(W-200)*w2), y+54+j*18], 2, (229, 231, 235))

    # Popup overlay
    px, py = W-400, 48
    pw, ph = 360, 400
    # Shadow
    shadow = Image.new("RGBA", (W, H), (0,0,0,0))
    sd = ImageDraw.Draw(shadow)
    rounded_rect(sd, [px+3, py+3, px+pw+3, py+ph+3], 16, (0,0,0,80))
    img.paste(Image.alpha_composite(Image.new("RGBA", (W,H), (0,0,0,0)), shadow).convert("RGB"), mask=shadow.split()[3])

    draw = ImageDraw.Draw(img)
    rounded_rect(draw, [px, py, px+pw, py+ph], 16, BG_SURFACE)

    # Header
    rounded_rect(draw, [px+16, py+14, px+40, py+38], 6, EMERALD)
    draw_pulse(draw, px+28, py+26, 18, 14, WHITE, 2)
    draw.text((px+50, py+16), "PagePulse", fill=TEXT_PRI, font=f14b)
    rounded_rect(draw, [px+pw-74, py+16, px+pw-16, py+36], 10, (6, 78, 59))
    draw.text((px+pw-66, py+19), "FREE", fill=(52, 211, 153), font=fm10)

    # Separator
    draw.line([(px, py+48), (px+pw, py+48)], fill=(255,255,255,15), width=1)

    # Monitor items
    monitors = [
        ("Amazon Widget Price", "12m ago · amazon.com", EMERALD, "3", True),
        ("Indeed Senior Dev Roles", "1h ago · indeed.com", EMERALD, "7", True),
        ("Gov.uk Visa Policy", "Broken · selector not found", RED, "0", False),
        ("MDN Web API Docs", "6h ago · developer.mozilla.org", EMERALD, "1", True),
    ]
    for i, (name, meta, color, count, active) in enumerate(monitors):
        iy = py + 58 + i * 56
        rounded_rect(draw, [px+12, iy, px+pw-12, iy+48], 8, BG_RAISED)
        draw_status_dot(draw, px+30, iy+24, 4, color)
        draw.text((px+46, iy+8), name, fill=TEXT_PRI, font=f13b)
        meta_color = RED_TEXT if "Broken" in meta else TEXT_TER
        draw.text((px+46, iy+28), meta, fill=meta_color, font=fm10)
        # Count badge
        badge_col = (6, 78, 59) if count != "0" else BG_ELEVATED
        text_col = (52, 211, 153) if count != "0" else TEXT_TER
        rounded_rect(draw, [px+pw-72, iy+14, px+pw-44, iy+34], 4, badge_col)
        draw.text((px+pw-64, iy+17), count, fill=text_col, font=fm11)
        # Toggle
        tog_color = EMERALD if active else BG_ELEVATED
        rounded_rect(draw, [px+pw-38, iy+15, px+pw-14, iy+33], 9, tog_color)
        dot_x = px+pw-22 if active else px+pw-34
        draw.ellipse([dot_x, iy+17, dot_x+12, iy+31], fill=WHITE)

    # Buttons
    by = py + ph - 72
    rounded_rect(draw, [px+12, by, px+12+(pw-30)//2, by+40], 8, EMERALD)
    draw.text((px+40, by+10), "+ Add Monitor", fill=(0,0,0), font=f13b)
    rounded_rect(draw, [px+18+(pw-30)//2, by, px+pw-12, by+40], 8, BG_RAISED)
    draw.text((px+32+(pw-30)//2, by+10), "Dashboard", fill=TEXT_SEC, font=f13)

    # Footer
    draw.line([(px, py+ph-26), (px+pw, py+ph-26)], fill=(255,255,255,15), width=1)
    draw.text((px+18, py+ph-18), "4/5 monitors", fill=TEXT_TER, font=fm11)
    rounded_rect(draw, [px+pw-80, py+ph-16, px+pw-18, py+ph-13], 2, BG_ELEVATED)
    rounded_rect(draw, [px+pw-80, py+ph-16, px+pw-42, py+ph-13], 2, EMERALD)

    return img


# ═══════════════════════════════════════
# SCREENSHOT 2: SELECTOR
# ═══════════════════════════════════════
def make_ss_selector():
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), PAGE_BG)
    draw = ImageDraw.Draw(img)
    f18b = try_font(18, bold=True)
    f13 = try_font(13)
    f24b = try_font(24, bold=True)
    f12 = try_font(12)
    f11 = try_font(11)
    fm11 = try_mono(11)
    fm10 = try_mono(10)

    # Browser chrome
    draw.rectangle([0, 0, W, 43], fill=(229, 231, 235))
    draw.ellipse([14, 16, 24, 26], fill=(239, 68, 68))
    draw.ellipse([30, 16, 40, 26], fill=(245, 158, 11))
    draw.ellipse([46, 16, 56, 26], fill=(34, 197, 94))
    rounded_rect(draw, [74, 10, 580, 34], 6, CARD_BG)
    draw.text((84, 14), "amazon.com/dp/B09XYZ/wireless-widget", fill=TEXT_TER, font=fm11)

    # Dim overlay
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 8))
    img.paste(Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB"))
    draw = ImageDraw.Draw(img)

    # Breadcrumb
    draw.text((120, 170), "Electronics  >  Accessories  >  Widgets", fill=TEXT_SEC, font=f12)

    # Product card
    cx, cy = 120, 210
    cw, ch = 540, 320
    rounded_rect(draw, [cx, cy, cx+cw, cy+ch], 12, CARD_BG)

    # Product image
    rounded_rect(draw, [cx+24, cy+24, cx+164, cy+164], 10, (224, 231, 255))
    draw.text((cx+70, cy+75), "W", fill=(165, 180, 252), font=try_font(48, bold=True))

    # Product text
    draw.text((cx+188, cy+24), "Wireless Smart Widget Pro", fill=(17, 24, 39), font=f18b)
    draw.text((cx+188, cy+56), "Premium wireless widget with auto-sync", fill=TEXT_SEC, font=f13)
    draw.text((cx+188, cy+76), "and 24-hour battery life.", fill=TEXT_SEC, font=f13)

    # HIGHLIGHTED price
    price_x, price_y = cx+188, cy+115
    # Blue highlight bg
    rounded_rect(draw, [price_x-10, price_y-8, price_x+130, price_y+38], 6, overlay_blend(CARD_BG, BLUE_HL, 0.06))
    # Blue outline
    for t in range(3):
        draw.rectangle([price_x-10-t, price_y-8-t, price_x+130+t, price_y+38+t], outline=BLUE_HL)
    draw.text((price_x, price_y), "$29.99", fill=GREEN_OK, font=f24b)

    draw.text((cx+188, cy+160), "In Stock  ·  Free delivery tomorrow", fill=TEXT_SEC, font=f12)

    # Instruction banner
    bw = 340
    bx = (W - bw) // 2
    by = 60
    rounded_rect(draw, [bx, by, bx+bw, by+36], 8, (15, 23, 42))
    draw.text((bx+36, by+8), "Click an element to monitor", fill=TEXT_PRI, font=f13)
    rounded_rect(draw, [bx+bw-50, by+7, bx+bw-14, by+27], 4, (255,255,255,30))
    draw.text((bx+bw-44, by+9), "ESC", fill=TEXT_SEC, font=fm10)

    # Side cards
    for i, (sy, sh) in enumerate([(210, 180), (410, 220)]):
        rounded_rect(draw, [700, sy, W-60, sy+sh], 12, CARD_BG)
        for j in range(4):
            w2 = [0.65, 0.8, 0.5, 0.7][j]
            rounded_rect(draw, [724, sy+24+j*22, int(724+(W-800)*w2), sy+34+j*22], 2, (229, 231, 235))

    # Bottom card
    rounded_rect(draw, [120, 560, 660, 740], 12, CARD_BG)
    for j in range(4):
        w2 = [0.8, 0.6, 0.7, 0.4][j]
        rounded_rect(draw, [144, 584+j*22, int(144+480*w2), 594+j*22], 2, (229, 231, 235))

    return img


# ═══════════════════════════════════════
# SCREENSHOT 3: DASHBOARD
# ═══════════════════════════════════════
def make_ss_dashboard():
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), BG_CANVAS)
    draw = ImageDraw.Draw(img)
    f18b = try_font(18, bold=True)
    f15b = try_font(15, bold=True)
    f14b = try_font(14, bold=True)
    f13b = try_font(13, bold=True)
    f13 = try_font(13)
    f12b = try_font(12, bold=True)
    f12 = try_font(12)
    f11 = try_font(11)
    f10 = try_font(10)
    fm14 = try_mono(14)
    fm13 = try_mono(13)
    fm11 = try_mono(11)
    fm10 = try_mono(10)

    # Header
    draw.rectangle([0, 0, W, 51], fill=BG_SURFACE)
    rounded_rect(draw, [16, 12, 44, 40], 7, EMERALD)
    draw_pulse(draw, 30, 26, 20, 16, WHITE, 2)
    draw.text((54, 15), "PagePulse", fill=TEXT_PRI, font=f15b)
    rounded_rect(draw, [W-200, 14, W-152, 36], 10, (6, 78, 59))
    draw.text((W-192, 18), "PRO", fill=(52, 211, 153), font=fm10)
    rounded_rect(draw, [W-140, 12, W-16, 40], 6, None, outline=overlay_blend(BG_SURFACE, EMERALD, 0.4))
    draw.text((W-130, 17), "Upgrade to Pro", fill=(52, 211, 153), font=f12)

    # Sidebar
    sw = 260
    draw.rectangle([0, 52, sw, H], fill=BG_SURFACE)
    draw.line([(sw, 52), (sw, H)], fill=(255,255,255,15), width=1)

    draw.text((16, 70), "MONITORS", fill=TEXT_TER, font=try_font(10, bold=True))
    rounded_rect(draw, [sw-56, 68, sw-12, 84], 3, BG_ELEVATED)
    draw.text((sw-50, 71), "4/50", fill=TEXT_TER, font=fm10)

    items = [
        ("Amazon Widget Price", "amazon.com", EMERALD, "3", True),
        ("Indeed Senior Dev Roles", "indeed.com", EMERALD, "7", False),
        ("Gov.uk Visa Policy", "gov.uk", RED, "—", False),
        ("MDN Web API Docs", "developer.mozilla.org", EMERALD, "1", False),
    ]
    for i, (name, host, color, cnt, active) in enumerate(items):
        iy = 100 + i * 52
        if active:
            rounded_rect(draw, [8, iy, sw-8, iy+44], 8, (28, 43, 58))
            draw.rectangle([8, iy+8, 11, iy+36], fill=EMERALD)
        draw_status_dot(draw, 28, iy+22, 3, color)
        draw.text((42, iy+6), name, fill=TEXT_PRI, font=f12b)
        draw.text((42, iy+24), host, fill=TEXT_TER, font=fm10)
        badge_bg = (6, 78, 59) if cnt != "—" else None
        badge_color = (52, 211, 153) if cnt != "—" else TEXT_TER
        if badge_bg:
            rounded_rect(draw, [sw-42, iy+12, sw-16, iy+30], 3, badge_bg)
        draw.text((sw-36, iy+14), cnt, fill=badge_color, font=fm10)

    # Main panel
    mx = sw + 28
    mw = W - sw - 56

    # Title
    draw.text((mx, 70), "Amazon Widget Price", fill=TEXT_PRI, font=f18b)
    draw.text((mx, 96), "amazon.com/dp/B09XYZ/wireless-widget", fill=(52, 211, 153), font=fm11)

    # Action buttons
    rounded_rect(draw, [W-340, 72, W-250, 104], 6, (6, 78, 59))
    draw.text((W-328, 82), "Check Now", fill=(52, 211, 153), font=f12b)
    rounded_rect(draw, [W-240, 72, W-172, 104], 6, BG_RAISED)
    draw.text((W-228, 82), "Export", fill=TEXT_SEC, font=f12)
    rounded_rect(draw, [W-162, 72, W-88, 104], 6, BG_RAISED)
    draw.text((W-150, 82), "Delete", fill=RED_TEXT, font=f12)

    # Stats grid
    sy = 120
    stat_w = mw // 4
    rounded_rect(draw, [mx, sy, mx+mw, sy+70], 10, BG_SURFACE)
    stats = [("STATUS", "Active", (52, 211, 153)), ("LAST CHECKED", "12 min ago", TEXT_PRI),
             ("CHANGES", "3", TEXT_PRI), ("TRACKING SINCE", "Mar 14", TEXT_PRI)]
    for i, (label, val, color) in enumerate(stats):
        sx = mx + i * stat_w
        if i > 0:
            draw.line([(sx, sy+10), (sx, sy+60)], fill=(255,255,255,15), width=1)
        draw.text((sx+16, sy+14), label, fill=TEXT_TER, font=try_font(9, bold=True))
        draw.text((sx+16, sy+36), val, fill=color, font=fm14)

    # Interval bar
    iy2 = 210
    rounded_rect(draw, [mx, iy2, mx+mw, iy2+44], 8, BG_SURFACE)
    draw.text((mx+16, iy2+13), "Check every", fill=TEXT_SEC, font=f12b)
    intervals = ["5m", "15m", "1h", "6h", "24h"]
    for idx, label in enumerate(intervals):
        bx = mx + 140 + idx * 62
        active = idx == 2
        pro = idx < 2
        if active:
            rounded_rect(draw, [bx, iy2+8, bx+50, iy2+36], 4, (6, 78, 59))
            draw.text((bx+12, iy2+13), label, fill=(52, 211, 153), font=fm11)
        else:
            col = TEXT_TER if not pro else (75, 85, 99)
            draw.text((bx+12, iy2+13), label, fill=col, font=fm11)
            if pro:
                draw.text((bx+36, iy2+6), "PRO", fill=(252, 211, 77), font=try_font(7, bold=True))

    # Current Value
    vy = 274
    draw.text((mx, vy), "CURRENT VALUE", fill=TEXT_TER, font=try_font(10, bold=True))
    draw.line([(mx+110, vy+6), (mx+mw, vy+6)], fill=(255,255,255,15), width=1)
    rounded_rect(draw, [mx, vy+20, mx+mw, vy+56], 8, BG_SURFACE)
    draw.text((mx+16, vy+30), "$29.99", fill=TEXT_SEC, font=fm13)

    # Change History
    hy = 354
    draw.text((mx, hy), "CHANGE HISTORY", fill=TEXT_TER, font=try_font(10, bold=True))
    draw.line([(mx+130, hy+6), (mx+mw, hy+6)], fill=(255,255,255,15), width=1)

    entries = [
        ("Mar 20, 2026 · 2:15 PM", "$34.99", "$29.99", None, None),
        ("Mar 18, 2026 · 9:42 AM", "$39.99", "$34.99", "Limited Stock", "In Stock"),
        ("Mar 15, 2026 · 11:08 PM", "$44.99", "$39.99", None, None),
    ]
    for i, (ts, old, new, old2, new2) in enumerate(entries):
        ey = hy + 24 + i * 100
        rounded_rect(draw, [mx, ey, mx+mw, ey+88], 8, BG_SURFACE)
        draw.line([(mx+1, ey+30), (mx+mw-1, ey+30)], fill=(255,255,255,15), width=1)
        draw.text((mx+16, ey+8), ts, fill=TEXT_TER, font=fm11)
        rounded_rect(draw, [mx+mw-80, ey+6, mx+mw-14, ey+24], 3, (6, 78, 59))
        draw.text((mx+mw-72, ey+8), "CHANGED", fill=(52, 211, 153), font=try_font(8, bold=True))

        # Diff
        dx = mx + 16
        dy = ey + 42
        draw.text((dx, dy), "Price: ", fill=TEXT_SEC, font=fm13)
        dx += 70
        rounded_rect(draw, [dx, dy-2, dx+70, dy+18], 3, DIFF_DEL_BG)
        draw.text((dx+4, dy), old, fill=DIFF_DEL_TEXT, font=fm13)
        dx += 80
        rounded_rect(draw, [dx, dy-2, dx+70, dy+18], 3, DIFF_ADD_BG)
        draw.text((dx+4, dy), new, fill=DIFF_ADD_TEXT, font=fm13)

        if old2:
            dx += 100
            draw.text((dx, dy), "— ", fill=TEXT_TER, font=fm13)
            dx += 20
            rounded_rect(draw, [dx, dy-2, dx+110, dy+18], 3, DIFF_DEL_BG)
            draw.text((dx+4, dy), old2, fill=DIFF_DEL_TEXT, font=fm13)
            dx += 120
            rounded_rect(draw, [dx, dy-2, dx+80, dy+18], 3, DIFF_ADD_BG)
            draw.text((dx+4, dy), new2, fill=DIFF_ADD_TEXT, font=fm13)

    return img


# ═══════════════════════════════════════
# SCREENSHOT 4: NOTIFICATIONS
# ═══════════════════════════════════════
def make_ss_notification():
    W, H = 1280, 800
    img = Image.new("RGB", (W, H), BG_ROOT)
    draw = ImageDraw.Draw(img)
    f13b = try_font(13, bold=True)
    f12 = try_font(12)
    f11b = try_font(11, bold=True)
    f11 = try_font(11)
    fm10 = try_mono(10)
    f15b = try_font(15, bold=True)

    # Dimmed dashboard background
    draw.rectangle([0, 0, W, 51], fill=overlay_blend(BG_ROOT, BG_SURFACE, 0.3))
    rounded_rect(draw, [16, 12, 44, 40], 7, overlay_blend(BG_ROOT, EMERALD, 0.3))
    draw.text((54, 15), "PagePulse", fill=overlay_blend(BG_ROOT, TEXT_PRI, 0.3), font=f15b)
    draw.rectangle([0, 52, 260, H], fill=overlay_blend(BG_ROOT, BG_SURFACE, 0.2))
    for i in range(5):
        rounded_rect(draw, [12, 100+i*52, 248, 140+i*52], 8, overlay_blend(BG_ROOT, BG_RAISED, 0.15))

    # Notification cards
    notifs = [
        (30, "Amazon Widget Price", "Price changed: $34.99 → $29.99", "now"),
        (136, "Indeed Senior Dev Roles", 'New listing: "Senior Backend Engineer — Remote"', "3m"),
    ]
    for ny, title, msg, time in notifs:
        nx = W - 420
        nw, nh = 390, 88
        # Shadow
        rounded_rect(draw, [nx+4, ny+4, nx+nw+4, ny+nh+4], 14, (0,0,0,120))
        # Card
        rounded_rect(draw, [nx, ny, nx+nw, ny+nh], 14, NOTIF_BG)
        # Icon
        rounded_rect(draw, [nx+14, ny+18, nx+54, ny+58], 9, EMERALD)
        draw_pulse(draw, nx+34, ny+38, 28, 22, WHITE, 2)
        # Text
        draw.text((nx+68, ny+14), "PAGEPULSE", fill=(142, 142, 147), font=try_font(9, bold=True))
        draw.text((nx+68, ny+30), title, fill=(242, 242, 247), font=f13b)
        draw.text((nx+68, ny+52), msg, fill=(174, 174, 178), font=f12)
        # Time
        draw.text((nx+nw-36, ny+14), time, fill=(99, 99, 102), font=f11)

    return img


# ═══════════════════════════════════════
# PROMO TILES
# ═══════════════════════════════════════
def make_promo(w, h):
    img = Image.new("RGB", (w, h), BG_ROOT)
    draw = ImageDraw.Draw(img)

    # Radial glow
    cx, cy = int(w * 0.35), h // 2
    for y in range(h):
        for x in range(w):
            dist = math.sqrt((x-cx)**2 + (y-cy)**2)
            max_d = math.sqrt(cx**2 + cy**2) * 0.8
            if dist < max_d:
                t = 1 - dist / max_d
                a = t * 0.06
                c = overlay_blend(BG_ROOT, EMERALD, a)
                img.putpixel((x, y), c)

    draw = ImageDraw.Draw(img)

    # Icon
    icon_s = min(w, h) * 0.25
    icon_x = int(w * 0.25 - icon_s/2)
    icon_y = int(h/2 - icon_s/2)
    icon_r = int(icon_s * 0.22)

    # Icon shadow/glow
    for g in range(20, 0, -1):
        gc = overlay_blend(BG_ROOT, EMERALD, 0.02 * (20 - g))
        rounded_rect(draw, [icon_x-g, icon_y-g, int(icon_x+icon_s+g), int(icon_y+icon_s+g)],
                     icon_r+g, gc)

    rounded_rect(draw, [icon_x, icon_y, int(icon_x+icon_s), int(icon_y+icon_s)], icon_r, EMERALD)
    # Darker bottom
    for y in range(int(icon_y + icon_s*0.5), int(icon_y + icon_s)):
        t = (y - icon_y - icon_s*0.5) / (icon_s * 0.5)
        for x in range(icon_x, int(icon_x + icon_s)):
            px = img.getpixel((x, y))
            nr = max(0, int(px[0] - t * 20))
            ng = max(0, int(px[1] - t * 20))
            nb = max(0, int(px[2] - t * 20))
            img.putpixel((x, y), (nr, ng, nb))

    draw = ImageDraw.Draw(img)
    th = max(2, int(icon_s * 0.04))
    draw_pulse(draw, int(icon_x + icon_s/2), int(icon_y + icon_s/2),
               int(icon_s*0.8), int(icon_s*0.55), WHITE, th)

    # Text
    tx = int(icon_x + icon_s + icon_s * 0.35)
    name_size = int(min(w, h) * 0.1)
    tag_size = int(min(w, h) * 0.045)
    tag2_size = int(min(w, h) * 0.038)

    name_font = try_font(name_size, bold=True)
    tag_font = try_font(tag_size)
    tag2_font = try_font(tag2_size)

    name_y = int(h/2 - name_size * 0.8)
    draw.text((tx, name_y), "PagePulse", fill=TEXT_PRI, font=name_font)
    draw.text((tx, name_y + int(name_size * 1.3)), "Website Change Monitor", fill=TEXT_SEC, font=tag_font)
    draw.text((tx, name_y + int(name_size * 1.3 + tag_size * 1.5)), "Track prices, jobs, and content updates", fill=TEXT_TER, font=tag2_font)

    return img


# ═══════════════════════════════════════
# GENERATE ALL
# ═══════════════════════════════════════
print("Generating PagePulse assets...\n")

# Icons
print("Extension icons:")
for size in [16, 48, 128]:
    icon = make_icon(size)
    path = os.path.join(ICONS, f"icon-{size}.png")
    icon.save(path)
    print(f"  {path}")

# Store icon
print("\nStore icon:")
icon128 = make_icon(128)
icon128.save(os.path.join(OUT, "icon-128.png"))
print(f"  {os.path.join(OUT, 'icon-128.png')}")

# Screenshots
print("\nScreenshots:")
make_ss_popup().save(os.path.join(OUT, "screenshot-1-popup.png"))
print(f"  screenshot-1-popup.png (1280x800)")
make_ss_selector().save(os.path.join(OUT, "screenshot-2-selector.png"))
print(f"  screenshot-2-selector.png (1280x800)")
make_ss_dashboard().save(os.path.join(OUT, "screenshot-3-dashboard.png"))
print(f"  screenshot-3-dashboard.png (1280x800)")
make_ss_notification().save(os.path.join(OUT, "screenshot-4-notification.png"))
print(f"  screenshot-4-notification.png (1280x800)")

# Promo tiles
print("\nPromo tiles:")
make_promo(440, 280).save(os.path.join(OUT, "small-tile-440x280.png"))
print(f"  small-tile-440x280.png")
make_promo(920, 680).save(os.path.join(OUT, "large-tile-920x680.png"))
print(f"  large-tile-920x680.png")
make_promo(1400, 560).save(os.path.join(OUT, "marquee-1400x560.png"))
print(f"  marquee-1400x560.png")

print("\nDone!")
