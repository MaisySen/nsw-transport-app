// Prints a fresh VAPID key pair for Web Push, ready to paste into .env.
import crypto from "node:crypto";
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const prv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
console.log("VAPID_PUBLIC_KEY=" + raw.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + prv.d);
