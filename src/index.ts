import Arweave from "arweave";
import { all, run } from "ar-gql";
import createQuery from "./queries/create.gql";
import shareQuery from "./queries/share.gql";
import removeQuery from "./queries/remove.gql";
import editQuery from "./queries/edit.gql";
import createWithIDQuery from "./queries/createWithID.gql";
import shareWithIDQuery from "./queries/shareWithID.gql";
import { JWKInterface } from "arweave/node/lib/wallet";
import {
  getDecryptionKey,
  decryptData,
  encryptData,
  getEncryptionKey,
} from "./encryption";
// @ts-ignore
import limestone from "@limestonefi/api";
import fetch from "node-fetch";
import { nanoid } from "nanoid";

const client = new Arweave({
  host: "arweave.net",
  port: 443,
  protocol: "https",
});

const getIDs = async (
  addr: string
): Promise<{ id: string; shared: boolean }[]> => {
  const createTxs = await all(createQuery, { addr });
  const shareTxs = await all(shareQuery, { addr });

  const res: { id: string; shared: boolean }[] = [];
  for (const tx of [...createTxs, ...shareTxs]) {
    const tag = tx.node.tags.find((tag) => tag.name === "ID");

    if (tag) {
      const id = tag.value;
      const removeTx = (await run(removeQuery, { addr, id })).data.transactions
        .edges[0];

      if (!removeTx) {
        res.push({
          id,
          shared: shareTxs
            .map((edge) => edge.node.id)
            .find((elem) => elem === tx.node.id)
            ? true
            : false,
        });
      }
    }
  }

  return res;
};

const getLatest = async (
  id: string,
  addr: string
): Promise<{ tx: string; mined: boolean }> => {
  const edits = (await run(editQuery, { addr, id })).data.transactions.edges;

  if (edits.length === 0) {
    const create = (await run(createWithIDQuery, { addr, id })).data
      .transactions.edges;

    if (create.length === 0) {
      const share = (await run(shareWithIDQuery, { addr, id })).data
        .transactions.edges;

      return {
        tx: share[0].node.id,
        mined: share[0].node.block ? true : false,
      };
    } else {
      return {
        tx: create[0].node.id,
        mined: create[0].node.block ? true : false,
      };
    }
  } else {
    return { tx: edits[0].node.id, mined: edits[0].node.block ? true : false };
  }
};

const getTx = async (tx: string, jwk: JWKInterface) => {
  const key = await getDecryptionKey(jwk);
  const data = await client.transactions.getData(tx, { decode: true });

  // @ts-ignore
  return await decryptData(data, key);
};

export const getPasswords = async (jwk: JWKInterface) => {
  const addr = await client.wallets.jwkToAddress(jwk);

  const res: {
    id: string;
    shared: boolean;
    tx: string;
    mined: boolean;
    site: string;
    username: string;
    password: string;
  }[] = [];

  for (const elem of await getIDs(addr)) {
    const { tx, mined } = await getLatest(elem.id, addr);
    const data = await getTx(tx, jwk);

    res.push({
      id: elem.id,
      shared: elem.shared,
      tx,
      mined,
      ...data,
    });
  }

  return res;
};

export const getFee = async (
  method: "create" | "share",
  addr?: string
): Promise<number> => {
  let fee = 0;
  if (method === "create" && addr) {
    const createTxs = await all(createQuery, { addr });
    if (createTxs.length >= 2) fee = 0.5;
  }
  if (method === "share") fee = 0.25;

  if (fee === 0) return 0;

  let price;
  try {
    price = 1 / (await limestone.getPrice("AR")).price;
  } catch {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd"
    );
    price = 1 / (await res.clone().json()).arweave.usd;
  }
  return parseFloat((price * fee).toFixed(4));
};

export const create = async (
  data: {
    site: string;
    username: string;
    password: string;
  },
  jwk: JWKInterface
): Promise<string | undefined> => {
  const addr = await client.wallets.jwkToAddress(jwk);
  const fee = await getFee("create", addr);
  if (
    fee >
    parseFloat(client.ar.winstonToAr(await client.wallets.getBalance(addr)))
  )
    return;

  const res = await encryptData(data, (await getEncryptionKey(addr))!);

  const tx = await client.createTransaction(
    fee > 0
      ? {
          target: "68JAKmnxrHOiNSXGzBk3O8Z7Mxdy3l4wUdJpnPlsNLw",
          quantity: client.ar.arToWinston(fee.toString()),
          data: res,
        }
      : {
          data: res,
        },
    jwk
  );

  tx.addTag("App-Name", "Sera");
  tx.addTag("ID", nanoid());
  tx.addTag("Action", "Create");

  await client.transactions.sign(tx, jwk);
  await client.transactions.post(tx);

  return tx.id;
};

export const share = async (
  id: string,
  target: string,
  jwk: JWKInterface
): Promise<string | undefined> => {
  const addr = await client.wallets.jwkToAddress(jwk);
  const fee = await getFee("share");
  if (
    fee >
    parseFloat(client.ar.winstonToAr(await client.wallets.getBalance(addr)))
  )
    return;

  const feeTx = await client.createTransaction(
    {
      target: "68JAKmnxrHOiNSXGzBk3O8Z7Mxdy3l4wUdJpnPlsNLw",
      quantity: client.ar.arToWinston(fee.toString()),
    },
    jwk
  );

  feeTx.addTag("App-Name", "Sera");
  feeTx.addTag("ID", id);
  feeTx.addTag("Action", "Share-Fee");

  await client.transactions.sign(feeTx, jwk);
  await client.transactions.post(feeTx);

  const res = await encryptData(
    await getTx((await getLatest(id, addr)).tx, jwk),
    (await getEncryptionKey(target))!
  );

  const tx = await client.createTransaction(
    {
      target,
      data: res,
    },
    jwk
  );

  tx.addTag("App-Name", "Sera");
  tx.addTag("ID", id);
  tx.addTag("Action", "Share");

  await client.transactions.sign(tx, jwk);
  await client.transactions.post(tx);

  return tx.id;
};

export const edit = async (
  id: string,
  data: {
    username?: string;
    password?: string;
  },
  jwk: JWKInterface
): Promise<string> => {
  const addr = await client.wallets.jwkToAddress(jwk);
  const item = await getTx((await getLatest(id, addr)).tx, jwk);

  const res = await encryptData(
    {
      site: item.site,
      username: data.username || item.username,
      password: data.password || item.password,
    },
    (await getEncryptionKey(addr))!
  );

  const tx = await client.createTransaction(
    {
      data: res,
    },
    jwk
  );

  tx.addTag("App-Name", "Sera");
  tx.addTag("ID", id);
  tx.addTag("Action", "Edit");

  await client.transactions.sign(tx, jwk);
  await client.transactions.post(tx);

  return tx.id;
};

export const remove = async (
  id: string,
  jwk: JWKInterface
): Promise<string> => {
  const tx = await client.createTransaction(
    {
      data: Math.random().toString().slice(-4),
    },
    jwk
  );

  tx.addTag("App-Name", "Sera");
  tx.addTag("ID", id);
  tx.addTag("Action", "Remove");

  await client.transactions.sign(tx, jwk);
  await client.transactions.post(tx);

  return tx.id;
};
