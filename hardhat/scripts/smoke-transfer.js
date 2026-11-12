const { ethers } = require("hardhat");
const { ROLES } = require("../network-accounts");

/**
 * Transfert ETH local réel : compte #0 « FreelanceTN Client » -> compte #1
 * « FreelanceTN Receiver ». Sert à vérifier que le nœud Hardhat produit bien
 * des transactions et des reçus exploitables par le backend.
 *
 * Usage : npm run smoke            (0,01 ETH par défaut)
 *         $env:AMOUNT_ETH="0.05"; npm run smoke
 */
async function main() {
  const amountEth = process.env.AMOUNT_ETH || process.argv[2] || "0.01";
  const signers = await ethers.getSigners();
  const client = signers[0];
  const receiver = signers[1];

  if (!client || !receiver) {
    throw new Error("Deux comptes Hardhat sont requis (Client et Receiver).");
  }

  const value = ethers.parseEther(amountEth);
  const network = await ethers.provider.getNetwork();
  const balanceBefore = await ethers.provider.getBalance(receiver.address);

  console.log("Transfert Hardhat local");
  console.log(`  réseau       : ${network.name} (chainId ${network.chainId})`);
  console.log(`  de           : ${client.address}  ${ROLES[0]}`);
  console.log(`  vers         : ${receiver.address}  ${ROLES[1]}`);
  console.log(`  montant      : ${amountEth} ETH (${value.toString()} wei)`);

  const tx = await client.sendTransaction({ to: receiver.address, value });
  console.log(`  hash         : ${tx.hash}`);
  console.log("  en attente du reçu…");

  const receipt = await tx.wait();
  const balanceAfter = await ethers.provider.getBalance(receiver.address);
  const latestBlock = await ethers.provider.getBlockNumber();
  const confirmations = Math.max(1, latestBlock - Number(receipt.blockNumber) + 1);

  console.log("");
  console.log("Reçu");
  console.log(`  bloc         : ${receipt.blockNumber}`);
  console.log(`  statut       : ${receipt.status === 1 ? "succès (0x1)" : "échec (0x0)"}`);
  console.log(`  gas utilisé  : ${receipt.gasUsed.toString()}`);
  console.log(`  confirmations: ${confirmations}`);
  console.log(`  solde Receiver avant : ${ethers.formatEther(balanceBefore)} ETH`);
  console.log(`  solde Receiver après : ${ethers.formatEther(balanceAfter)} ETH`);

  const onChain = await ethers.provider.getTransaction(tx.hash);
  const ok =
    onChain &&
    onChain.from.toLowerCase() === client.address.toLowerCase() &&
    onChain.to &&
    onChain.to.toLowerCase() === receiver.address.toLowerCase() &&
    onChain.value === value;

  console.log("");
  console.log(
    ok
      ? "Vérification locale OK : expéditeur, destinataire et montant exact relus on-chain."
      : "Vérification locale en échec : la transaction relue ne correspond pas.",
  );

  process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
