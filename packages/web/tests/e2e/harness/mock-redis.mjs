import { createServer } from "node:net";

/** RESP wire fixture for auth-v2's Redis commands. Unsupported commands fail. */
export function createRedisFixture() {
  const records = new Map();
  const sockets = new Set();
  function get(key) {
    const entry = records.get(key);
    if (entry?.expiresAt <= Date.now()) {
      records.delete(key);
      return null;
    }
    return entry?.value ?? null;
  }
  function set(key, value, seconds) {
    records.set(key, { value, expiresAt: Date.now() + Number(seconds) * 1000 });
  }
  function execute(args) {
    const [command, ...params] = args;
    const [key, value] = params;
    switch (command.toUpperCase()) {
      case "HELLO": {
        if (
          key !== "3" ||
          params[1] !== "AUTH" ||
          params[3] !== "fixture-password"
        )
          throw new Error("invalid RESP3 handshake");
        return new Map([
          ["server", "redis"],
          ["version", "8.0.0"],
          ["proto", 3],
          ["id", 1],
          ["mode", "standalone"],
          ["role", "master"],
          ["modules", []],
        ]);
      }
      case "AUTH":
        if (params.at(-1) !== "fixture-password")
          throw new Error("invalid fixture password");
        return "OK";
      case "CLIENT":
        if (
          !["SETINFO", "SETNAME", "MAINT_NOTIFICATIONS"].includes(
            key.toUpperCase(),
          )
        )
          throw new Error("unsupported CLIENT command");
        return "OK";
      case "PING":
        return "PONG";
      case "QUIT":
        return "OK";
      case "SET": {
        const options = params.slice(2);
        if (options.includes("NX") && get(key) !== null) return null;
        const expiry = options.indexOf("EX");
        if (expiry < 0) throw new Error("SET requires EX");
        set(key, value, options[expiry + 1]);
        return "OK";
      }
      case "GET":
        return get(key);
      case "GETDEL": {
        const found = get(key);
        records.delete(key);
        return found;
      }
      case "DEL":
        return params.reduce(
          (sum, entry) => sum + Number(records.delete(entry)),
          0,
        );
      case "SADD": {
        const members = get(key) ?? new Set();
        const previous = members.size;
        members.add(value);
        records.set(key, {
          value: members,
          expiresAt: records.get(key)?.expiresAt ?? Infinity,
        });
        return members.size - previous;
      }
      case "SMEMBERS":
        return [...(get(key) ?? [])];
      case "SREM":
        return Number(get(key)?.delete(value) ?? false);
      case "EXPIRE": {
        if (get(key) === null) return 0;
        records.get(key).expiresAt = Date.now() + Number(value) * 1000;
        return 1;
      }
      case "EVAL": {
        const [script, keyCount, recordKey, expected, replacement, seconds] =
          params;
        if (keyCount !== "1") throw new Error("unsupported EVAL keys");
        const normalized = script.replace(/\s+/gu, " ").trim();
        const compareSet =
          'if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3]) return 1 end return 0';
        const compareDelete =
          'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0';
        if (![compareSet, compareDelete].includes(normalized))
          throw new Error("unsupported EVAL script");
        if (get(recordKey) !== expected) return 0;
        if (normalized === compareSet) set(recordKey, replacement, seconds);
        else records.delete(recordKey);
        return 1;
      }
      default:
        throw new Error(`unsupported command ${command}`);
    }
  }
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let authenticated = false;
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        let parsed;
        try {
          parsed = parseCommand(pending);
        } catch {
          socket.destroy();
          return;
        }
        if (!parsed) break;
        pending = pending.subarray(parsed.bytes);
        try {
          const command = parsed.args[0].toUpperCase();
          if (!authenticated && command !== "AUTH" && command !== "HELLO")
            throw new Error("authentication required");
          const reply = execute(parsed.args);
          if (command === "AUTH" || command === "HELLO") authenticated = true;
          socket.write(encode(reply));
        } catch {
          socket.write("-ERR unsupported or invalid fixture command\r\n");
        }
      }
    });
  });
  return {
    listen: (port) =>
      new Promise((resolve) =>
        server.listen(port, "127.0.0.1", () => resolve(server.address().port)),
      ),
    reset: () => records.clear(),
    records,
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

function parseCommand(buffer) {
  const headerEnd = buffer.indexOf("\r\n");
  if (headerEnd < 0) return null;
  if (buffer[0] !== 42) throw new Error("expected RESP array");
  const count = Number(buffer.subarray(1, headerEnd).toString());
  let offset = headerEnd + 2;
  const args = [];
  for (let index = 0; index < count; index++) {
    const end = buffer.indexOf("\r\n", offset);
    if (end < 0) return null;
    if (buffer[offset] !== 36) throw new Error("expected bulk string");
    const length = Number(buffer.subarray(offset + 1, end).toString());
    const next = end + 2 + length + 2;
    if (buffer.length < next) return null;
    args.push(buffer.subarray(end + 2, next - 2).toString());
    offset = next;
  }
  return { args, bytes: offset };
}
function encode(value) {
  if (value instanceof Map)
    return `%${value.size}\r\n${[...value].map(([key, entry]) => encode(key) + encode(entry)).join("")}`;
  if (value === null) return "$-1\r\n";
  if (typeof value === "number") return `:${value}\r\n`;
  if (Array.isArray(value))
    return `*${value.length}\r\n${value.map(encode).join("")}`;
  return `$${Buffer.byteLength(value)}\r\n${value}\r\n`;
}
