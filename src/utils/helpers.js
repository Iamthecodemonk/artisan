export function pick(obj = {}, keys = []) {
  const out = {};
  keys.forEach((k) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  });
  return out;
}

export function respond(reply, data, code = 200) {
  return reply.code(code).send({ success: true, data });
}
