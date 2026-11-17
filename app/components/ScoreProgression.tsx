'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import type {LiveEvent} from '../lib/live-sports';
import {scoreProgression, type ScoreStep} from '../lib/score-progression';

const awayColor = '#82d9e9';
const homeColor = '#ffb477';

function drawChart(canvas: HTMLCanvasElement, steps: ScoreStep[], selected: number) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 32 || height < 32) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const drawing = canvas.getContext('2d');
  if (!drawing) return;
  drawing.scale(scale,scale);

  const left=36, top=12, right=width-12, bottom=height-14;
  const maxScore = Math.max(4,...steps.flatMap(step=>[step.away,step.home]));
  const interval = Math.ceil(maxScore/4);
  const max = interval*4;
  const xAt = (index:number) => left+(right-left)*index/(steps.length-1);
  const yAt = (value:number) => bottom-(bottom-top)*value/max;

  drawing.font = '11px system-ui';
  drawing.textAlign = 'right';
  drawing.textBaseline = 'middle';
  drawing.fillStyle = '#b3a8a1';
  drawing.strokeStyle = '#40393e';
  for (let value = 0; value <= max; value+=interval) {
    const y = yAt(value);
    drawing.beginPath();
    drawing.moveTo(left,y);
    drawing.lineTo(right,y);
    drawing.stroke();
    drawing.fillText(String(value),left-6,y);
  }
  const marker = xAt(selected);
  drawing.strokeStyle = '#b3a8a1';
  drawing.setLineDash([2,4]);
  drawing.beginPath();
  drawing.moveTo(marker,top);
  drawing.lineTo(marker,bottom);
  drawing.stroke();

  for (const side of ['away','home'] as const) {
    const color = side==='away'?awayColor:homeColor;
    drawing.strokeStyle=color;
    drawing.lineWidth=2;
    drawing.setLineDash(side==='away'?[6,4]:[]);
    drawing.beginPath();
    drawing.moveTo(xAt(0),yAt(steps[0][side]));
    for(let index=1;index<steps.length;index++){
      drawing.lineTo(xAt(index),yAt(steps[index-1][side]));
      drawing.lineTo(xAt(index),yAt(steps[index][side]));
    }
    drawing.stroke();
    drawing.fillStyle=color;
    drawing.beginPath();
    drawing.arc(marker,yAt(steps[selected][side]),3,0,Math.PI*2);
    drawing.fill();
  }
}

export function ScoreProgression({event}: {event: LiveEvent}) {
  const steps=useMemo(()=>scoreProgression(event.timeline??[],event.scoringPlays??[]),[event.timeline,event.scoringPlays]);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const selected = steps.findIndex(step=>step.id===selectedId);
  const index = selected>=0?selected:steps.length-1;
  const step = steps[index];
  useEffect(()=>{
    if (!canvas.current || steps.length<2) return;
    const plot=canvas.current;
    const render=()=>drawChart(plot,steps,index);
    const observer=new ResizeObserver(render);
    observer.observe(plot);
    render();
    return ()=>observer.disconnect();
  },[steps,index]);

  if (!step || steps.length<2) return null;
  const label=[step.period && `${event.sport==='baseball'?'Inning':'Period'} ${step.period}`,step.clock].filter(Boolean).join(' · ');
  const score = `${event.away.shortName} ${step.away}, ${event.home.shortName} ${step.home}`;
  return <section className="cw-score-progression" aria-label="Score progression">
    <h3>Score progression</h3>
    <div className="cw-score-legend" aria-hidden="true">
      <span className="cw-score-away">{event.away.shortName}</span>
      <span className="cw-score-home">{event.home.shortName}</span>
    </div>
    <canvas ref={canvas} aria-hidden="true"/>
    <label className="cw-score-scrub">Recorded score updates
      <input type="range" min={0} max={steps.length-1} value={index}
        aria-valuetext={`Update ${index+1} of ${steps.length}: ${score}`}
        onChange={change=>setSelectedId(steps[Number(change.target.value)].id)}/>
    </label>
    <div className="cw-score-step">
      <strong>{score}</strong>
      <small>{label || `Update ${index+1} of ${steps.length}`}</small>
      <p>{step.description}</p>
    </div>
  </section>;
}
