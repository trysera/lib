import Arweave from "arweave";
import { JWKInterface } from "arweave/node/lib/wallet";
import { run } from "ar-gql";
import txQuery from "./queries/tx.gql";

const client = new Arweave({
  host: "arweave.net",
  port: 443,
  protocol: "https",
});

export const encrypt = async (
  site: string,
  username: string,
  password: string,
  publicKey: CryptoKey
) => {
  const dataBuf = new TextEncoder().encode(
    JSON.stringify({
      site,
      username,
      password,
    })
  );
  const keyBuf = await randomBytes(256);

  const encryptedData = await client.crypto.encrypt(dataBuf, keyBuf);
  const encryptedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    keyBuf
  );

  return client.utils.concatBuffers([encryptedKey, encryptedData]);
};

export const decrypt = async (data: Uint8Array, key: CryptoKey) => {
  const encryptedKey = new Uint8Array(data.slice(0, 512));
  const encryptedData = new Uint8Array(data.slice(512));

  const symmetricKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    key,
    encryptedKey
  );

  return await client.crypto.decrypt(
    encryptedData,
    new Uint8Array(symmetricKey)
  );
};

export const jwkToKey = async (jwk: JWKInterface) => {
  const obj = {
    ...jwk,
    alg: "RSA-OAEP-256",
    ext: true,
  };
  const algo = { name: "RSA-OAEP", hash: { name: "SHA-256" } };

  return await crypto.subtle.importKey("jwk", obj, algo, false, ["decrypt"]);
};

export const getPublicKey = async (addr: string) => {
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

const randomBytes = (length: number) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
};
