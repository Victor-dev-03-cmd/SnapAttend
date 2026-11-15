import app from './backend.ts';
import {startScheduler} from './services/scheduler.ts';

startScheduler();
Bun.serve({port:Number(process.env.PORT)||3000,fetch:app.fetch});
