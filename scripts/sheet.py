# Contact sheet of screenshots for quick review: sheet.py OUT.jpg cols img...
import sys
from PIL import Image
out, cols, fs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert('RGB') for f in fs]; w = 1440 // cols; ims = [i.resize((w, int(i.height * w / i.width))) for i in ims]; h = ims[0].height
W = Image.new('RGB', (w * cols, h * ((len(ims) + cols - 1) // cols)))
for i, im in enumerate(ims): W.paste(im, ((i % cols) * w, (i // cols) * h))
W.save(out, quality=82)
