// Negative fixture for the determinism lint: each restricted construct once, on known lines.
export const now = Date.now(); // line 2
export const today = new Date(); // line 3
export const roll = Math.random(); // line 4
export const tick = performance.now(); // line 5
export const precise = process.hrtime.bigint(); // line 6
setTimeout(() => {}, 1); // line 7
setInterval(() => {}, 1); // line 8
setImmediate(() => {}); // line 9
export const signal = AbortSignal.timeout(1); // line 10
