import { all, run } from "ar-gql";
import createQuery from "./queries/create.gql";
import shareQuery from "./queries/share.gql";
import removeQuery from "./queries/remove.gql";

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
