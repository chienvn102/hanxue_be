/**
 * Legacy import shim.
 *
 * New code should import ./gemini.service. This file stays temporarily because
 * existing controllers still require "../services/gemini".
 */

module.exports = require('./gemini.service');
