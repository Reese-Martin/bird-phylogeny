import {FONT,DISPLAY_FONT,type ColorPalette} from '../tree/visual-theme';

export interface ExportRect {x:number;y:number;width:number;height:number}
export interface ExportCardPlan extends ExportRect {
  /** Native-pixel tree viewport, excluding the artwork padding. */
  art:ExportRect;
  artBackground:ExportRect;
  copy:ExportRect;
}
export interface ExportGridPlan {
  width:number;
  height:number;
  columns:number;
  rows:number;
  cards:readonly ExportCardPlan[];
  header:ExportRect;
  footer:ExportRect;
  margin:number;
  gap:number;
}

const MAX_SIDE=4096,MAX_PIXELS=12000000,MIN_CARD_WIDTH=150;
const even=(value:number)=>Math.ceil(value/2)*2;

function candidateGrid(panelCount:number,width:number,columns:number):ExportGridPlan|null {
  const compact=width<1000,margin=compact?20:32,gap=compact?12:16;
  const headerHeight=compact?84:96,footerHeight=compact?100:104,copyHeight=compact?66:76;
  const cardWidth=(width-margin*2-gap*(columns-1))/columns;
  if(cardWidth<MIN_CARD_WIDTH)return null;
  const artHeight=cardWidth/1.55,cardHeight=Math.ceil(artHeight+copyHeight),rows=Math.ceil(panelCount/columns);
  const gridY=margin+headerHeight,gridHeight=rows*cardHeight+(rows-1)*gap;
  const footerY=gridY+gridHeight+gap,height=even(footerY+footerHeight+margin);
  if(height>MAX_SIDE||width*height>MAX_PIXELS)return null;
  const inset=compact?10:12;
  const cards=Array.from({length:panelCount},(_,index)=>{
    const x=margin+(index%columns)*(cardWidth+gap),y=gridY+Math.floor(index/columns)*(cardHeight+gap);
    return{x,y,width:cardWidth,height:cardHeight,artBackground:{x,y,width:cardWidth,height:artHeight},art:{x:x+inset,y:y+inset,width:cardWidth-inset*2,height:artHeight-inset*2},copy:{x,y:y+artHeight,width:cardWidth,height:cardHeight-artHeight}};
  });
  return{width,height,columns,rows,cards,header:{x:margin,y:margin,width:width-margin*2,height:headerHeight-gap},footer:{x:margin,y:footerY,width:width-margin*2,height:footerHeight},margin,gap};
}

/**
 * Fit every tree into one bounded native-pixel canvas. The requested width is
 * preferred; unusually large country sets may grow it to keep labels readable.
 */
export function planExportGrid(panelCount:number,requestedWidth=1280):ExportGridPlan {
  if(!Number.isInteger(panelCount)||panelCount<1||panelCount>1000)throw new Error('Export needs between 1 and 1,000 trees.');
  if(!Number.isFinite(requestedWidth)||requestedWidth<480||requestedWidth>MAX_SIDE)throw new Error('Export width must be between 480 and 4,096 pixels.');
  const preferredWidth=even(requestedWidth),preferredColumns=Math.min(panelCount,preferredWidth>=1100?4:preferredWidth>=720?3:2);
  for(let width=preferredWidth;width<=MAX_SIDE;width=Math.min(MAX_SIDE,width+64)){
    const maximumColumns=Math.min(panelCount,Math.floor((width-64+16)/(MIN_CARD_WIDTH+16)));
    for(let columns=preferredColumns;columns<=maximumColumns;columns++){
      const plan=candidateGrid(panelCount,width,columns);
      if(plan)return plan;
    }
    if(width===MAX_SIDE)break;
  }
  throw new Error('These trees exceed the 4,096-pixel / 12-megapixel export limit.');
}

export interface ExportCompositionPanel {
  name:string;
  count:number;
  total:number;
  undatedCount?:number;
  draw:(ctx:CanvasRenderingContext2D,width:number,height:number)=>void;
}
export interface ExportCompositionOptions {
  title:string;
  date:string|null;
  panels:readonly ExportCompositionPanel[];
  colors:Readonly<ColorPalette>;
  subtitle?:string;
  credits?:string;
  notes?:string;
}

function shortened(ctx:CanvasRenderingContext2D,text:string,width:number):string {
  if(ctx.measureText(text).width<=width)return text;
  let result=text;
  while(result.length&&ctx.measureText(`${result}…`).width>width)result=result.slice(0,-1);
  return result?`${result}…`:'';
}

/** Wrap only inside the supplied box; excessive text ends with an explicit ellipsis. */
function textBox(ctx:CanvasRenderingContext2D,text:string,box:ExportRect,lineHeight:number,maxLines:number):number {
  const words=text.trim().split(/\s+/).filter(Boolean),lines:string[]=[];
  let line='';
  while(words.length&&lines.length<maxLines){
    const word=words.shift()!,next=line?`${line} ${word}`:word;
    if(line&&ctx.measureText(next).width>box.width){lines.push(line);line=word;}
    else line=next;
    if(lines.length===maxLines){words.unshift(line);line='';break;}
  }
  if(line&&lines.length<maxLines)lines.push(line);
  if(words.length&&lines.length)lines[lines.length-1]=shortened(ctx,`${lines[lines.length-1]}…`,box.width);
  const count=Math.min(lines.length,Math.floor(box.height/lineHeight));
  for(let index=0;index<count;index++)ctx.fillText(shortened(ctx,lines[index],box.width),box.x,box.y+index*lineHeight,box.width);
  return count*lineHeight;
}

const number=(value:number)=>Math.max(0,Math.trunc(Number.isFinite(value)?value:0)).toLocaleString('en');
const dateLabel=(date:string|null)=>date&&/^\d{4}-\d{2}-\d{2}$/.test(date)?new Intl.DateTimeFormat('en',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`)):'Before the first recorded bird';

/** Render a complete frame, including offscreen country cards and attribution. */
export function drawExportComposition(ctx:CanvasRenderingContext2D,plan:ExportGridPlan,options:ExportCompositionOptions):void {
  if(options.panels.length!==plan.cards.length)throw new Error('Export panel count does not match the composition.');
  const {colors}=options,compact=plan.width<1000;
  ctx.save();
  try{
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle=colors.paper;ctx.fillRect(0,0,plan.width,plan.height);
    ctx.textBaseline='top';ctx.textAlign='left';ctx.fillStyle=colors.ink;ctx.font=`600 ${compact?23:28}px ${DISPLAY_FONT}`;
    ctx.fillText(shortened(ctx,options.title,plan.header.width),plan.header.x,plan.header.y,plan.header.width);
    ctx.font=`500 ${compact?11:12}px ${FONT}`;ctx.fillStyle=colors.label;
    ctx.fillText(shortened(ctx,options.subtitle||'The same date in every tree · country-first sightings',plan.header.width),plan.header.x,plan.header.y+(compact?34:40),plan.header.width);
    ctx.font=`600 ${compact?13:15}px ${FONT}`;ctx.fillStyle=colors.accent;
    ctx.fillText(dateLabel(options.date),plan.header.x,plan.header.y+(compact?55:64),plan.header.width);
    options.panels.forEach((panel,index)=>{
      const card=plan.cards[index];
      ctx.save();
      try{
        ctx.beginPath();ctx.roundRect(card.x,card.y,card.width,card.height,9);ctx.clip();
        ctx.fillStyle=colors.paper;ctx.fillRect(card.x,card.y,card.width,card.height);
        ctx.fillStyle=colors.surface;ctx.fillRect(card.artBackground.x,card.artBackground.y,card.artBackground.width,card.artBackground.height);
        ctx.save();
        try{
          ctx.beginPath();ctx.rect(card.art.x,card.art.y,card.art.width,card.art.height);ctx.clip();ctx.translate(card.art.x,card.art.y);
          panel.draw(ctx,card.art.width,card.art.height);
        }finally{ctx.restore();}
        ctx.strokeStyle=colors.muted;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(card.x,card.copy.y);ctx.lineTo(card.x+card.width,card.copy.y);ctx.stroke();
        const pad=compact?11:14,countWidth=card.width<220?64:82,titleWidth=Math.max(10,card.width-pad*2-countWidth-8);
        ctx.textBaseline='top';ctx.textAlign='left';ctx.fillStyle=colors.ink;ctx.font=`700 ${card.width<220?12:compact?14:15}px ${FONT}`;
        textBox(ctx,panel.name,{x:card.x+pad,y:card.copy.y+13,width:titleWidth,height:40},18,2);
        ctx.textAlign='right';ctx.font=`600 ${compact?21:23}px ${FONT}`;
        ctx.fillText(number(panel.count),card.x+card.width-pad,card.copy.y+11,countWidth);
        ctx.font=`500 ${compact?9:10}px ${FONT}`;ctx.fillStyle=colors.label;
        ctx.fillText(shortened(ctx,`of ${number(panel.total)} species`,countWidth),card.x+card.width-pad,card.copy.y+37,countWidth);
        ctx.textAlign='left';ctx.font=`500 ${compact?9:10}px ${FONT}`;
        const context=panel.undatedCount?`${number(panel.undatedCount)} without a usable date`:'Growing life list';
        ctx.fillText(shortened(ctx,context,card.width-pad*2),card.x+pad,card.y+card.height-17,card.width-pad*2);
      }finally{ctx.restore();}
      ctx.strokeStyle=colors.muted;ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(card.x+.5,card.y+.5,card.width-1,card.height-1,9);ctx.stroke();
    });
    ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle=colors.label;
    ctx.font=`500 ${compact?9:10}px ${FONT}`;
    let y=plan.footer.y;
    const notes=options.notes||'First sightings · Portraits spaced to fit.';
    y+=textBox(ctx,notes,{...plan.footer,y,height:Math.min(40,plan.footer.height)},compact?12:13,3)+8;
    ctx.font=`500 ${compact?8:9}px ${FONT}`;
    if(options.credits)textBox(ctx,options.credits,{...plan.footer,y,height:plan.footer.y+plan.footer.height-y},compact?11:12,Math.floor((plan.footer.y+plan.footer.height-y)/(compact?11:12)));
  }finally{ctx.restore();}
}
