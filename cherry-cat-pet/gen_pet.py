import os
from PIL import Image, ImageDraw

CELL_W, CELL_H = 192, 208
COLS, ROWS = 8, 11
ATLAS_W, ATLAS_H = CELL_W * COLS, CELL_H * ROWS

# Colors
WHITE = (255, 255, 255, 255)
GREY_TABBY = (140, 130, 115, 255)
DARK_TABBY = (90, 80, 70, 255)
BROWN_TABBY = (160, 130, 90, 255)
PINK_NOSE = (230, 150, 150, 255)
GREEN_EYE = (120, 170, 90, 255)
DARK_PUPIL = (40, 40, 40, 255)
RED_COLLAR = (200, 50, 50, 255)
CHERRY_RED = (180, 30, 30, 255)
CHERRY_STEM = (80, 120, 50, 255)
OUTLINE = (50, 45, 40, 255)
EAR_INNER = (220, 170, 160, 255)
BELLY_WHITE = (250, 250, 252, 255)
PAW_PINK = (235, 180, 175, 255)
TAIL_TABBY = (130, 120, 100, 255)
TRANSPARENT = (0, 0, 0, 0)

def draw_cat_body(draw, cx, cy, scale=1.0, pose="idle", frame=0):
    """Draw a cute calico tabby cat at (cx, cy) center point."""
    s = scale
    
    # Body (oval, white with patches)
    body_w, body_h = int(60*s), int(45*s)
    body_top = cy - int(10*s)
    draw.ellipse([cx - body_w, body_top, cx + body_w, body_top + body_h*2], fill=WHITE, outline=OUTLINE, width=max(1, int(2*s)))
    
    # Tabby patches on body
    patch_x = cx + int(15*s)
    patch_y = body_top + int(10*s)
    draw.ellipse([patch_x - int(20*s), patch_y, patch_x + int(20*s), patch_y + int(25*s)], fill=GREY_TABBY)
    # Small brown patch
    draw.ellipse([cx - int(35*s), body_top + int(20*s), cx - int(10*s), body_top + int(35*s)], fill=BROWN_TABBY)
    
    # Head (circle, larger)
    head_r = int(38*s)
    head_cy = body_top - int(18*s)
    draw.ellipse([cx - head_r, head_cy - head_r, cx + head_r, head_cy + head_r], fill=WHITE, outline=OUTLINE, width=max(1, int(2*s)))
    
    # Tabby patches on head (top-left and right)
    draw.ellipse([cx - head_r + int(5*s), head_cy - head_r + int(5*s), cx - int(5*s), head_cy - int(5*s)], fill=GREY_TABBY)
    draw.ellipse([cx + int(5*s), head_cy - head_r + int(5*s), cx + head_r - int(5*s), head_cy], fill=DARK_TABBY)
    # Forehead M marking
    draw.line([cx - int(12*s), head_cy - int(20*s), cx - int(6*s), head_cy - int(28*s), cx, head_cy - int(22*s), cx + int(6*s), head_cy - int(28*s), cx + int(12*s), head_cy - int(20*s)], fill=DARK_TABBY, width=max(1, int(2*s)))
    
    # Ears (triangles)
    ear_w, ear_h = int(18*s), int(22*s)
    # Left ear
    le = [(cx - int(28*s), head_cy - int(20*s)), (cx - int(15*s), head_cy - int(20*s)), (cx - int(22*s), head_cy - int(20*s) - ear_h)]
    draw.polygon(le, fill=GREY_TABBY, outline=OUTLINE, width=max(1, int(2*s)))
    le_in = [(cx - int(26*s), head_cy - int(20*s) + int(5*s)), (cx - int(17*s), head_cy - int(20*s) + int(5*s)), (cx - int(22*s), head_cy - int(20*s) - ear_h + int(7*s))]
    draw.polygon(le_in, fill=EAR_INNER)
    # Right ear
    re = [(cx + int(15*s), head_cy - int(20*s)), (cx + int(28*s), head_cy - int(20*s)), (cx + int(22*s), head_cy - int(20*s) - ear_h)]
    draw.polygon(re, fill=DARK_TABBY, outline=OUTLINE, width=max(1, int(2*s)))
    re_in = [(cx + int(17*s), head_cy - int(20*s) + int(5*s)), (cx + int(26*s), head_cy - int(20*s) + int(5*s)), (cx + int(22*s), head_cy - int(20*s) - ear_h + int(7*s))]
    draw.polygon(re_in, fill=EAR_INNER)
    
    # Eyes
    eye_y = head_cy - int(2*s)
    eye_sep = int(16*s)
    eye_w, eye_h = int(10*s), int(11*s)
    # White of eyes
    draw.ellipse([cx - eye_sep - eye_w, eye_y - eye_h, cx - eye_sep + eye_w, eye_y + eye_h], fill=WHITE, outline=OUTLINE, width=max(1, int(1*s)))
    draw.ellipse([cx + eye_sep - eye_w, eye_y - eye_h, cx + eye_sep + eye_w, eye_y + eye_h], fill=WHITE, outline=OUTLINE, width=max(1, int(1*s)))
    # Irises
    iris_r = int(7*s)
    draw.ellipse([cx - eye_sep - iris_r, eye_y - iris_r, cx - eye_sep + iris_r, eye_y + iris_r], fill=GREEN_EYE)
    draw.ellipse([cx + eye_sep - iris_r, eye_y - iris_r, cx + eye_sep + iris_r, eye_y + iris_r], fill=GREEN_EYE)
    # Pupils (with frame variation for blinking)
    pupil_r = int(4*s)
    blink = (pose == "idle" and frame in [1, 2])
    if blink:
        # Blink - closed eyes
        draw.arc([cx - eye_sep - eye_w, eye_y - int(3*s), cx - eye_sep + eye_w, eye_y + int(3*s)], 0, 180, fill=OUTLINE, width=max(1, int(2*s)))
        draw.arc([cx + eye_sep - eye_w, eye_y - int(3*s), cx + eye_sep + eye_w, eye_y + int(3*s)], 0, 180, fill=OUTLINE, width=max(1, int(2*s)))
    else:
        draw.ellipse([cx - eye_sep - pupil_r, eye_y - pupil_r, cx - eye_sep + pupil_r, eye_y + pupil_r], fill=DARK_PUPIL)
        draw.ellipse([cx + eye_sep - pupil_r, eye_y - pupil_r, cx + eye_sep + pupil_r, eye_y + pupil_r], fill=DARK_PUPIL)
        # Eye shine
        shine_r = int(2*s)
        draw.ellipse([cx - eye_sep - int(3*s) - shine_r, eye_y - int(3*s) - shine_r, cx - eye_sep - int(3*s) + shine_r, eye_y - int(3*s) + shine_r], fill=WHITE)
        draw.ellipse([cx + eye_sep - int(3*s) - shine_r, eye_y - int(3*s) - shine_r, cx + eye_sep - int(3*s) + shine_r, eye_y - int(3*s) + shine_r], fill=WHITE)
    
    # Nose (small pink triangle)
    nose_y = head_cy + int(10*s)
    nose_size = int(5*s)
    draw.polygon([(cx, nose_y + nose_size), (cx - nose_size, nose_y), (cx + nose_size, nose_y)], fill=PINK_NOSE, outline=OUTLINE, width=max(1, int(1*s)))
    
    # Mouth
    mouth_y = nose_y + int(6*s)
    draw.arc([cx - int(10*s), mouth_y - int(5*s), cx, mouth_y + int(5*s)], 0, 180, fill=OUTLINE, width=max(1, int(1*s)))
    draw.arc([cx, mouth_y - int(5*s), cx + int(10*s), mouth_y + int(5*s)], 0, 180, fill=OUTLINE, width=max(1, int(1*s)))
    
    # Whiskers
    w_y = nose_y + int(2*s)
    for i, angle in enumerate([-10, 0, 10]):
        draw.line([cx - int(20*s), w_y + int(angle*s), cx - int(45*s), w_y + int((angle - 5)*s)], fill=OUTLINE, width=max(1, int(1*s)))
        draw.line([cx + int(20*s), w_y + int(angle*s), cx + int(45*s), w_y + int((angle - 5)*s)], fill=OUTLINE, width=max(1, int(1*s)))
    
    # Collar with cherries
    collar_y = body_top + int(5*s)
    collar_h = int(8*s)
    draw.rectangle([cx - body_w + int(10*s), collar_y, cx + body_w - int(10*s), collar_y + collar_h], fill=RED_COLLAR, outline=OUTLINE, width=max(1, int(1*s)))
    # Cherry charm (left)
    cherry_x = cx - int(10*s)
    cherry_y = collar_y + collar_h + int(3*s)
    cherry_r = int(5*s)
    draw.ellipse([cherry_x - cherry_r, cherry_y - cherry_r, cherry_x + cherry_r, cherry_y + cherry_r], fill=CHERRY_RED, outline=OUTLINE, width=max(1, int(1*s)))
    draw.line([cherry_x, cherry_y - cherry_r, cherry_x + int(3*s), collar_y + collar_h], fill=CHERRY_STEM, width=max(1, int(1*s)))
    # Cherry charm (right)
    cherry2_x = cx + int(10*s)
    draw.ellipse([cherry2_x - cherry_r, cherry_y - cherry_r, cherry2_x + cherry_r, cherry_y + cherry_r], fill=CHERRY_RED, outline=OUTLINE, width=max(1, int(1*s)))
    draw.line([cherry2_x, cherry_y - cherry_r, cherry2_x - int(3*s), collar_y + collar_h], fill=CHERRY_STEM, width=max(1, int(1*s)))
    
    # Front paws
    paw_y = body_top + body_h*2 - int(5*s)
    paw_w, paw_h = int(14*s), int(10*s)
    draw.ellipse([cx - int(30*s) - paw_w, paw_y - paw_h, cx - int(30*s) + paw_w, paw_y + paw_h], fill=WHITE, outline=OUTLINE, width=max(1, int(1*s)))
    draw.ellipse([cx + int(30*s) - paw_w, paw_y - paw_h, cx + int(30*s) + paw_w, paw_y + paw_h], fill=WHITE, outline=OUTLINE, width=max(1, int(1*s)))
    # Paw pads
    pad_r = int(3*s)
    draw.ellipse([cx - int(30*s) - pad_r, paw_y + int(2*s) - pad_r, cx - int(30*s) + pad_r, paw_y + int(2*s) + pad_r], fill=PAW_PINK)
    draw.ellipse([cx + int(30*s) - pad_r, paw_y + int(2*s) - pad_r, cx + int(30*s) + pad_r, paw_y + int(2*s) + pad_r], fill=PAW_PINK)
    
    # Tail (curving up-right)
    tail_start_x = cx + body_w - int(15*s)
    tail_start_y = body_top + body_h - int(10*s)
    tail_points = []
    for t in range(20):
        tt = t / 19.0
        tx = tail_start_x + int(tt * 35*s)
        ty = tail_start_y - int(tt * 40*s * (1 - tt * 0.3))
        tail_points.append((tx, ty))
    if len(tail_points) > 1:
        for i in range(len(tail_points)-1):
            draw.line([tail_points[i], tail_points[i+1]], fill=TAIL_TABBY, width=max(1, int(8*s)))
        # Tail tip
        draw.ellipse([tail_points[-1][0] - int(5*s), tail_points[-1][1] - int(5*s), tail_points[-1][0] + int(5*s), tail_points[-1][1] + int(5*s)], fill=GREY_TABBY)


def gen_idle(atlas):
    """Row 0: idle animation - gentle breathing and blinking"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 0, (f+1)*CELL_W, CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Breathing offset
        breathe = [0, -1, -2, -1, 0, 1, 2, 1][f]
        cy += breathe
        
        if f < 6:
            draw_cat_body(draw, cx, cy, scale=1.0, pose="idle", frame=f)
        atlas.paste(frame, (f*CELL_W, 0))


def gen_running_right(atlas):
    """Row 1: running right with alternating legs"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, CELL_H, (f+1)*CELL_W, 2*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Lean forward
        lean = [0, 2, 4, 2, 0, -2, -4, -2][f]
        bounce = [0, -3, -6, -3, 0, -3, -6, -3][f]
        
        draw_cat_body(draw, cx + lean, cy + bounce, scale=0.95, pose="run")
        # Extra leg motion lines
        if f % 2 == 0:
            leg_y = cy + bounce + int(40*0.95)
            draw.line([cx + lean - int(50*0.95), leg_y, cx + lean - int(70*0.95), leg_y + 8], fill=OUTLINE, width=2)
            draw.line([cx + lean + int(40*0.95), leg_y, cx + lean + int(60*0.95), leg_y + 8], fill=OUTLINE, width=2)
        atlas.paste(frame, (f*CELL_W, CELL_H))


def gen_waving(atlas):
    """Row 3: waving gesture"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 3*CELL_H, (f+1)*CELL_W, 4*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        draw_cat_body(draw, cx, cy, scale=1.0, pose="wave")
        
        # Waving paw (right side, going up and down)
        paw_y = [cy - 10, cy - 30, cy - 50, cy - 30, cy - 10, cy + 10, cy - 10, cy - 30][f]
        paw_x = cx + int(50*1.0)
        paw_r = int(10*1.0)
        draw.ellipse([paw_x - paw_r, paw_y - paw_r, paw_x + paw_r, paw_y + paw_r], fill=WHITE, outline=OUTLINE, width=2)
        draw.ellipse([paw_x - int(4), paw_y - int(4), paw_x + int(4), paw_y + int(4)], fill=PAW_PINK)
        # Arm connecting paw to body
        draw.line([cx + int(45), cy + 15, paw_x, paw_y], fill=OUTLINE, width=max(1, int(3*1.0)))
        
        atlas.paste(frame, (f*CELL_W, 3*CELL_H))


def gen_jumping(atlas):
    """Row 4: jumping arc"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 4*CELL_H, (f+1)*CELL_W, 5*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Jump arc
        jump_y = [0, -15, -35, -50, -50, -35, -15, 0][f]
        squash = [1.0, 1.0, 1.0, 0.95, 0.95, 1.0, 1.0, 1.05][f]
        
        draw_cat_body(draw, cx, cy + jump_y, scale=squash, pose="jump")
        
        # Squash/stretch effect on ground frame
        if f == 7:
            # Landing impact lines
            for dx in [-30, -15, 0, 15, 30]:
                draw.line([cx + dx, cy + 45, cx + dx + (5 if dx > 0 else -5), cy + 55], fill=OUTLINE, width=1)
        
        atlas.paste(frame, (f*CELL_W, 4*CELL_H))


def gen_failed(atlas):
    """Row 5: failed/error reaction - droopy pose"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 5*CELL_H, (f+1)*CELL_W, 6*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 15
        
        droop = [0, 3, 5, 5, 5, 5, 3, 0][f]
        
        draw_cat_body(draw, cx, cy + droop, scale=0.95, pose="failed")
        
        # Sad expression - add sweat drop or X marks
        if f >= 2 and f <= 5:
            # Sweat drop
            sx = cx + int(40*0.95)
            sy = cy + droop - int(45*0.95)
            draw.polygon([(sx, sy), (sx-4, sy+10), (sx+4, sy+10)], fill=(100, 180, 230, 200))
        
        # X eyes for some frames
        if f in [3, 4]:
            eye_sep = int(16*0.95)
            eye_y = cy + droop - int(20*0.95)
            for ex in [cx - eye_sep, cx + eye_sep]:
                draw.line([ex - 5, eye_y - 5, ex + 5, eye_y + 5], fill=OUTLINE, width=2)
                draw.line([ex + 5, eye_y - 5, ex - 5, eye_y + 5], fill=OUTLINE, width=2)
        
        atlas.paste(frame, (f*CELL_W, 5*CELL_H))


def gen_waiting(atlas):
    """Row 6: waiting/asking pose"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 6*CELL_H, (f+1)*CELL_W, 7*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Slight sway
        sway = [0, 2, 3, 2, 0, -2, -3, -2][f]
        
        draw_cat_body(draw, cx + sway, cy, scale=1.0, pose="waiting")
        
        # Raised front paws (begging)
        paw_y = cy - int(10)
        for px in [cx - int(25), cx + int(25)]:
            paw_r = int(8)
            draw.ellipse([px - paw_r, paw_y - int(30) - paw_r, px + paw_r, paw_y - int(30) + paw_r], fill=WHITE, outline=OUTLINE, width=2)
            draw.line([px, paw_y + int(20), px, paw_y - int(20)], fill=OUTLINE, width=3)
        
        atlas.paste(frame, (f*CELL_W, 6*CELL_H))


def gen_running(atlas):
    """Row 7: active task/processing animation"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 7*CELL_H, (f+1)*CELL_W, 8*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Typing/working animation
        bounce = [0, -2, -4, -2, 0, -2, -4, -2][f]
        tilt = [0, 1, 2, 1, 0, -1, -2, -1][f]
        
        draw_cat_body(draw, cx + tilt, cy + bounce, scale=0.95, pose="working")
        
        # Laptop/screen in front
        screen_x = cx - int(35)
        screen_y = cy + bounce + int(30)
        draw.rectangle([screen_x - 25, screen_y - 15, screen_x + 25, screen_y + 5], fill=(60, 60, 80, 200), outline=OUTLINE, width=1)
        # Screen glow lines
        for i in range(3):
            line_x = screen_x - 18 + i * 12
            line_w = [8, 12, 6][i]
            draw.line([line_x, screen_y - 10, line_x + line_w, screen_y - 10], fill=(100, 200, 150, 180), width=1)
        
        atlas.paste(frame, (f*CELL_W, 7*CELL_H))


def gen_review(atlas):
    """Row 8: review/inspection pose"""
    for f in range(8):
        frame = atlas.crop((f*CELL_W, 8*CELL_H, (f+1)*CELL_W, 9*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        # Head tilt for review
        tilt = [0, 3, 5, 3, 0, -3, -5, -3][f]
        
        draw_cat_body(draw, cx + tilt, cy, scale=1.0, pose="review")
        
        # Magnifying glass
        mg_x = cx + int(40)
        mg_y = cy - int(20) + [0, -2, -4, -2, 0, 2, 4, 2][f]
        mg_r = int(15)
        draw.ellipse([mg_x - mg_r, mg_y - mg_r, mg_x + mg_r, mg_y + mg_r], outline=OUTLINE, width=3)
        draw.line([mg_x + int(mg_r * 0.7), mg_y + int(mg_r * 0.7), mg_x + int(mg_r * 1.5), mg_y + int(mg_r * 1.5)], fill=OUTLINE, width=3)
        
        atlas.paste(frame, (f*CELL_W, 8*CELL_H))


def gen_look_directions(atlas, row_idx):
    """Rows 9-10: 16 look directions (8 per row), clockwise from 0 degrees"""
    start_angle = row_idx * 8 * 22.5  # 0 or 180
    
    for f in range(8):
        angle = (start_angle + f * 22.5) % 360
        frame = atlas.crop((f*CELL_W, row_idx*CELL_H, (f+1)*CELL_W, (row_idx+1)*CELL_H))
        draw = ImageDraw.Draw(frame)
        cx, cy = CELL_W // 2, CELL_H // 2 + 10
        
        draw_cat_body(draw, cx, cy, scale=1.0, pose="look")
        
        # Eye direction offset based on angle
        import math
        rad = math.radians(angle)
        eye_dx = int(math.sin(rad) * 3)
        eye_dy = -int(math.cos(rad) * 3)
        
        # Redraw eyes with offset pupils
        eye_y = cy - int(22*1.0) + eye_dy
        eye_sep = int(16*1.0)
        pupil_r = int(4*1.0)
        for ex in [cx - eye_sep, cx + eye_sep]:
            # Clear eye area
            draw.ellipse([ex - int(10), eye_y - int(11), ex + int(10), eye_y + int(11)], fill=WHITE)
            draw.ellipse([ex - int(7), eye_y - int(7), ex + int(7), eye_y + int(7)], fill=GREEN_EYE)
            draw.ellipse([ex + eye_dx - pupil_r, eye_y + eye_dy - pupil_r, ex + eye_dx + pupil_r, eye_y + eye_dy + pupil_r], fill=DARK_PUPIL)
            # Shine
            draw.ellipse([ex + eye_dx - 3 - 2, eye_y + eye_dy - 3 - 2, ex + eye_dx - 3 + 2, eye_y + eye_dy - 3 + 2], fill=WHITE)
        
        atlas.paste(frame, (f*CELL_W, row_idx*CELL_H))


def main():
    ws = r'C:\Users\lizhu\Desktop\my-mindmap agent 2608200101\cherry-cat-pet'
    atlas = Image.new('RGBA', (ATLAS_W, ATLAS_H), TRANSPARENT)
    
    print("Generating idle (row 0)...")
    gen_idle(atlas)
    
    print("Generating running-right (row 1)...")
    gen_running_right(atlas)
    
    print("Generating running-left (row 2)...")
    # Mirror running-right
    for f in range(8):
        src = atlas.crop((f*CELL_W, CELL_H, (f+1)*CELL_W, 2*CELL_H))
        mirrored = src.transpose(Image.FLIP_LEFT_RIGHT)
        atlas.paste(mirrored, ((7-f)*CELL_W, 2*CELL_H))
    
    print("Generating waving (row 3)...")
    gen_waving(atlas)
    
    print("Generating jumping (row 4)...")
    gen_jumping(atlas)
    
    print("Generating failed (row 5)...")
    gen_failed(atlas)
    
    print("Generating waiting (row 6)...")
    gen_waiting(atlas)
    
    print("Generating running (row 7)...")
    gen_running(atlas)
    
    print("Generating review (row 8)...")
    gen_review(atlas)
    
    print("Generating look directions A (row 9)...")
    gen_look_directions(atlas, 9)
    
    print("Generating look directions B (row 10)...")
    gen_look_directions(atlas, 10)
    
    # Save atlas
    atlas_path = os.path.join(ws, 'spritesheet.png')
    atlas.save(atlas_path, 'PNG')
    print(f"Saved atlas: {atlas_path}")
    print(f"Size: {atlas.size}")
    
    # Save as WebP too
    webp_path = os.path.join(ws, 'spritesheet.webp')
    atlas.save(webp_path, 'WEBP', quality=90)
    print(f"Saved WebP: {webp_path}")
    
    # Create contact sheet
    cs_w, cs_h = ATLAS_W, ATLAS_H
    contact = Image.new('RGBA', (cs_w, cs_h + 40), (40, 40, 50, 255))
    contact.paste(atlas, (0, 40))
    draw_cs = ImageDraw.Draw(contact)
    draw_cs.text((10, 10), "Cherry Cat Pet - Contact Sheet", fill=WHITE)
    contact_path = os.path.join(ws, 'qa', 'contact-sheet.png')
    contact.save(contact_path, 'PNG')
    print(f"Saved contact sheet: {contact_path}")

if __name__ == '__main__':
    main()
