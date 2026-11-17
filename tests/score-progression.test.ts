import assert from 'node:assert/strict';
import test from 'node:test';
import {scoreProgression} from '../app/lib/score-progression';

const play = (id:string,awayScore:number|null,homeScore:number|null) => ({
  id,description:`Update ${id}`,side:null,period:1,clock:'1:00',awayScore,homeScore,
});

test('score progression orders observed changes and retains score corrections', () => {
  const timeline = [
    play('6',3,7),play('5',3,7),play('4',3,8),play('3',null,2),play('2',3,0),play('1',0,0),
  ];
  const steps = scoreProgression(timeline,[]);
  assert.deepEqual(steps.map(step=>[step.id,step.away,step.home]),[
    ['1',0,0],['2',3,0],['4',3,8],['5',3,7],
  ]);
});

test('score progression falls back to scoring plays without inserting a starting score', () => {
  const steps = scoreProgression([play('3',9,6)],[play('3',9,6),play('2',7,6),play('1',3,0)]);
  assert.deepEqual(steps.map(step=>step.away),[3,7,9]);
  assert.deepEqual(scoreProgression([play('2',null,null)],[play('1',-1,0)]),[]);
});
