// Preloaded with `node --import` into a server the tests spawn: Google as it
// looks behind a dropped route. Host names resolve to a TEST-NET address and
// every connection to it hangs, neither opening nor failing. Nothing leaves
// the process. Each attempt leaves an "[unreachable]" line on stderr.
import dns from "node:dns";
import net from "node:net";

const ADDRESS = { address: "192.0.2.1", family: 4 };
const note = (what) => process.stderr.write(`[unreachable] ${what}\n`);
const notFound = () => Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });

net.Socket.prototype.connect = function connect() {
  note("connect");
  return this;
};
dns.lookup = function lookup(host, options, callback) {
  note(`lookup ${host}`);
  const done = typeof options === "function" ? options : callback;
  process.nextTick(() => (options?.all ? done(null, [ADDRESS]) : done(null, ADDRESS.address, ADDRESS.family)));
};
dns.promises.lookup = async function lookup(host, options) {
  note(`lookup ${host}`);
  return options?.all ? [ADDRESS] : ADDRESS;
};
dns.promises.resolveTxt = async function resolveTxt() {
  throw notFound();
};
