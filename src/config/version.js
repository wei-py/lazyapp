/* global LAZYAPP_VERSION */
// Replaced at build time by bun build --define
const VERSION = typeof LAZYAPP_VERSION !== 'undefined' ? LAZYAPP_VERSION : '0.0.0-dev'
export { VERSION }
