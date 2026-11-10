import {selectFruitFrame} from './sprites/frames.js';
export function fruitHistory(level){const n=Math.max(1,Math.floor(level)||1);return Array.from({length:Math.min(n,7)},(_,i)=>selectFruitFrame(Math.max(1,n-6)+i));}
export const hudLayoutForMode=mode=>mode==='arcade'?'arcade':'competition';
export const spareLives=lives=>Math.min(5,Math.max(0,Math.floor(lives)-1));
export const scoreText=score=>score>0?String(Math.floor(score)):'00';
