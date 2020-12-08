import { all, run } from "ar-gql";
import createQuery from "./queries/create.gql";
import shareQuery from "./queries/share.gql";
import removeQuery from "./queries/remove.gql";
import editQuery from "./queries/edit.gql";
import createWithIDQuery from "./queries/createWithID.gql";
import shareWithIDQuery from "./queries/shareWithID.gql";

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
