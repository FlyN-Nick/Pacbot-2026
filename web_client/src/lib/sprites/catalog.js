export const catalog = {};
function add(key,x,y,width=16,height=16,asset='general.png',sheetWidth=680,sheetHeight=248){
 catalog[key]={asset,x,y,width,height,sheetWidth,sheetHeight,anchor:{x:8,y:8}};
}
for(const [direction,row] of [['right',0],['left',1],['up',2],['down',3]])for(let f=0;f<3;f++)add(`pacman-${direction}-${f}`,456+16*f,16*row);
for(let f=0;f<11;f++)add(`death-${f}`,504+16*f,0);
add('blank',664,224);
for(const [color,row] of [['red',4],['pink',5],['cyan',6],['orange',7]])for(const [direction,col]of [['right',0],['left',2],['up',4],['down',6]])for(let f=0;f<2;f++)add(`ghost-${color}-${direction}-${f}`,456+(col+f)*16,row*16);
for(const [color,col]of [['blue',8],['white',10]])for(let f=0;f<2;f++)add(`fright-${color}-${f}`,456+(col+f)*16,64);
for(const [direction,col]of [['right',8],['left',9],['up',10],['down',11]])add(`eyes-${direction}`,456+col*16,80);
export const FRUITS=['cherry','strawberry','orange','apple','melon','galaxian','bell','key'];
FRUITS.forEach((fruit,i)=>add(`fruit-${fruit}`,504+i*16,48));
const lines=['ABCDEFGHIJKLMNO','PQRSTUVWXYZ/-.','0123456789'];
for(const [color,offset] of [['white',0],['red',32],['pink',64],['cyan',96],['orange',128],['peach',160],['yellow',192]])for(let row=0;row<lines.length;row++)for(let col=0;col<lines[row].length;col++)add(`glyph-${color}-${lines[row][col]}`,col*8,offset+row*8,8,8,'text.png',128,224);

add('life',0,0,16,16,'life.png',16,16);

add('glyph-yellow-!',0,0,8,8,'punctuation.png',8,8);
