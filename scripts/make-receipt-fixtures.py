"""Synthetic receipts only. Never use private receipt photos as fixtures."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out=Path('public/receipt-fixtures');out.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/meiryo.ttc',36)
fixtures={
 'japanese':['合成テスト領収書','2026年11月14日','食品 2点','小計           ¥1,185','内消費税          ¥95','合計           ¥1,280','お預り         ¥2,000','お釣り           ¥720'],
 'english':['SYNTHETIC TEST RECEIPT','2026-11-14','GROCERIES','SUBTOTAL       1185','TAX              95','TOTAL          1280','CASH           2000','CHANGE          720'],
 'mixed':['合成 TEST RECEIPT','2026/11/14','食品 / GROCERIES','合計 / TOTAL   ¥1,280','現金 / CASH    ¥2,000','お釣り CHANGE    ¥720']
}
for name,lines in fixtures.items():
 image=Image.new('RGB',(900,1100),'white');draw=ImageDraw.Draw(image)
 for i,line in enumerate(lines):draw.text((65,65+i*95),line,font=font,fill='black')
 image.save(out/(name+'.png'))
