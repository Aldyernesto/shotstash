// One JSON line per event on stdout (errors on stderr). Never pass a token here.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger({ level = 'info', write = (line, lvl) => (lvl === 'error' ? process.stderr : process.stdout).write(line) } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    const entry = { time: new Date().toISOString(), level: lvl, app: 'shotstash-worker', msg, ...fields };
    if (fields.err instanceof Error) entry.err = { message: fields.err.message, code: fields.err.code ?? undefined };
    write(`${JSON.stringify(entry)}\n`, lvl);
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
