import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import { run } from "ar-gql";
import txQuery from "./queries/tx.gql";

const client = new Arweave({
  host: "arweave.net",
  port: 443,
  protocol: "https",
});

export const encryptData = async (
  data: {
    site: string;
    username: string;
    password: string;
  },
  key: CryptoKey
): Promise<Uint8Array> => {
  const dataBuf = new TextEncoder().encode(JSON.stringify(data));
  const keyBuf = await randomBytes(256);

  const encryptedData = await client.crypto.encrypt(dataBuf, keyBuf);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    keyBuf
  );

  return client.utils.concatBuffers([encryptedKey, encryptedData]);
};

export const decryptData = async (
  data: Uint8Array,
  key: CryptoKey
): Promise<{
  site: string;
  username: string;
  password: string;
}> => {
  const encryptedKey = new Uint8Array(data.slice(0, 512));
  const encryptedData = new Uint8Array(data.slice(512));

  const symmetricKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    key,
    encryptedKey
  );

  const res = await client.crypto.decrypt(
    encryptedData,
    new Uint8Array(symmetricKey)
  );

  return JSON.parse(client.utils.bufferToString(res));
};

export const getDecryptionKey = async (
  jwk: JWKInterface
): Promise<CryptoKey> => {
  const obj = {
    ...jwk,
    alg: "RSA-OAEP-256",
    ext: true,
  };
  const algo = { name: "RSA-OAEP", hash: { name: "SHA-256" } };

  return await crypto.subtle.importKey("jwk", obj, algo, false, ["decrypt"]);
};

export const getEncryptionKey = async (
  addr: string
): Promise<CryptoKey | undefined> => {
  const tx = (await run(txQuery, { addr })).data.transactions.edges[0];

  if (tx) {
    const obj = {
      kty: "RSA",
      e: "AQAB",
      n: tx.node.owner.key,
      alg: "RSA-OAEP-256",
      ext: true,
    };
    const algo = { name: "RSA-OAEP", hash: { name: "SHA-256" } };

    return await crypto.subtle.importKey("jwk", obj, algo, false, ["encrypt"]);
  }
};

const randomBytes = (length: number): Uint8Array => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
};
