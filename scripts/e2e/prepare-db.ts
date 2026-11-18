// Fresh database for browser checks: the sample reading test, a listening drill (with transcript, read aloud), a writing task,
// and for Phase 6 a chart gallery, a Task 2 plan + introduction drill and a speaking test.
//   npx tsx scripts/e2e/prepare-db.ts        (writes .data/e2e/ids.json)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { exampleTestForType } from '../../shared/src';
import { openDatabase } from '../../server/src/db/client';
import { seedSample } from '../../server/src/seed';
import { createTest } from '../../server/src/tests/repository';

rmSync('.data/e2e', { recursive: true, force: true });
mkdirSync('.data/e2e', { recursive: true });
const d = await openDatabase({ pgliteDir: '.data/e2e/pglite' });
await d.migrate();
await seedSample(d.db);
const listening = await createTest(d.db, { ...exampleTestForType('form_completion'), title: 'Listening drill — Hotel booking', timeLimitMin: 10 }, { source: 'claude' });
const writing = await createTest(d.db, { ...exampleTestForType('writing_task1'), title: 'Writing Task 1 — City temperatures', kind: 'homework', dueDate: '2026-12-31' }, { source: 'claude' });

// Phase 6: every Task 1 chart type, the Task 2 plan + introduction drill, and a speaking test
const task1 = (id: string, charts: unknown[]) => ({ id: `part-${id}`, title: `Task 1 — ${id}`, questionGroups: [{ id, type: 'writing_task1', prompt: `The ${id} below shows information. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.`, charts }] });
const gallery = await createTest(d.db, {
  title: 'Chart gallery (e2e)', skill: 'writing', kind: 'practice',
  parts: [
    task1('line', [{ chartType: 'line', title: 'Average temperature in three cities', unit: '°C', xLabel: 'Month', yLabel: 'Temperature (°C)', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [
      { name: 'London', values: [5, 6, 9, 12, 15, 18] }, { name: 'Cairo', values: [14, 16, 19, 23, 27, 29] }, { name: 'Moscow', values: [-7, -6, null, 6, 13, 17] }] }]),
    task1('bars', [
      { chartType: 'bar', title: 'Visitors to three museums', unit: 'thousands', labels: ['2019', '2020', '2021', '2022'], series: [
        { name: 'Science', values: [420, 180, 260, 390] }, { name: 'History', values: [310, 120, 200, 330] }, { name: 'Art', values: [150, 60, 110, 170] }] },
      { chartType: 'bar', orientation: 'horizontal', stacked: true, title: 'How students travel to school', unit: '%', labels: ['Walk', 'Bicycle', 'Bus', 'Car', 'Train'], series: [
        { name: '2000', values: [30, 10, 25, 25, 10] }, { name: '2020', values: [22, 18, 30, 20, 10] }] }]),
    task1('pie', [{ chartType: 'pie', title: 'Electricity sources', unit: '%', pies: [
      { title: '1990', slices: [{ label: 'Coal', value: 52 }, { label: 'Gas', value: 23 }, { label: 'Nuclear', value: 17 }, { label: 'Renewables', value: 8 }] },
      { title: '2020', slices: [{ label: 'Coal', value: 18 }, { label: 'Gas', value: 35 }, { label: 'Nuclear', value: 16 }, { label: 'Renewables', value: 31 }] }] }]),
    task1('process', [{ chartType: 'process', title: 'How glass bottles are recycled', cyclic: true, steps: [
      { label: 'Collection', detail: 'bottles are taken to a collection point' }, { label: 'Sorting', detail: 'by colour' }, { label: 'Cleaning' },
      { label: 'Melting', detail: 'at 1,500°C' }, { label: 'Moulding', detail: 'into new bottles' }] },
      { chartType: 'table', title: 'Bottles recycled per year', unit: 'millions', columns: ['Country', '2010', '2020'], rows: [['Spain', 120, 210], ['Italy', 140, 260], ['Greece', 30, 75]] }]),
    task1('maps', [{ chartType: 'map', title: 'Riverside village', maps: [
      { title: '1995', features: [{ label: 'River', shape: 'water', x: 50, y: 88, width: 100, height: 14 }, { label: 'Main Road', shape: 'road', x: 50, y: 50 }, { label: 'Farm', shape: 'area', x: 25, y: 25, width: 34, height: 30 }, { label: 'Houses', shape: 'building', x: 72, y: 28, width: 18, height: 14 }, { label: 'Forest', shape: 'trees', x: 75, y: 70, width: 30, height: 16 }] },
      { title: 'Today', features: [{ label: 'River', shape: 'water', x: 50, y: 88, width: 100, height: 14 }, { label: 'Main Road', shape: 'road', x: 50, y: 50 }, { label: 'Shopping centre', shape: 'building', x: 25, y: 25, width: 30, height: 22 }, { label: 'Houses', shape: 'building', x: 72, y: 28, width: 18, height: 14 }, { label: 'Car park', shape: 'area', x: 75, y: 70, width: 30, height: 16 }, { label: 'Bus stop', shape: 'point', x: 45, y: 42 }] }] }])
  ]
}, { source: 'claude' });
const drill = await createTest(d.db, { ...exampleTestForType('writing_task2'), title: 'Task 2 drill (e2e)', kind: 'homework' }, { source: 'claude' });
const p1 = exampleTestForType('speaking_part1'), p2 = exampleTestForType('speaking_part2');
const speaking = await createTest(d.db, {
  title: 'Speaking practice (e2e)', skill: 'speaking', kind: 'practice',
  parts: [
    { ...(p1.parts[0] as object), id: 'sp1', title: 'Part 1' } as never,
    { ...(p2.parts[0] as object), id: 'sp2', title: 'Part 2' } as never
  ]
}, { source: 'claude' });
writeFileSync('.data/e2e/ids.json', JSON.stringify({ sample: '5a3f6c1e-0000-4000-8000-000000000001', listening: listening.id, writing: writing.id, gallery: gallery.id, drill: drill.id, speaking: speaking.id }));
await d.close();
console.log('Ready. Start the server with:  PGLITE_DIR=.data/e2e/pglite UPLOAD_DIR=.data/e2e/uploads node server/dist/main.js');
