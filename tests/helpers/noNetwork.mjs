// Preloaded with `node --import` into a server the tests spawn, so the child
// cannot reach the network whatever its env says. Every attempt is refused
// and leaves a "[no-network]" line on stderr, which the tests check for.
import dns from "node:dns";
import net from "node:net";

function refuse(what) {
  process.stderr.write(`[no-network] refused ${what}\n`);
  throw new Error(`network is disabled in this test process (${what})`);
}

// net.connect, tls.connect, http(s) and gRPC all end in Socket#connect.
net.Socket.prototype.connect = function connect() {
  return refuse("socket connect");
};
dns.lookup = function lookup() {
  return refuse("dns lookup");
};
dns.promises.lookup = async function lookup() {
  return refuse("dns lookup");
};
globalThis.fetch = async function fetch() {
  return refuse("fetch");
};
