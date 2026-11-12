const { ethers } = require("hardhat");
const {
  MNEMONIC,
  ACCOUNT_COUNT,
  ROLES,
} = require("../network-accounts");

/**
 * Affiche les comptes de développement du réseau Hardhat local FreelanceTN :
 * adresse publique, clé privée et solde. Ces clés n'existent que sur la
 * chaîne locale 31337 : aucun fonds réel, aucun usage possible sur un réseau
 * public. Ne les utilisez jamais ailleurs que dans MetaMask sur Hardhat Local.
 */
async function main() {
  let chainId = "n/a";
  let blockNumber = "n/a";
  let nodeReachable = true;

  try {
    const network = await ethers.provider.getNetwork();
    chainId = network.chainId.toString();
    blockNumber = (await ethers.provider.getBlockNumber()).toString();
  } catch (error) {
    nodeReachable = false;
    console.warn(
      "Nœud Hardhat injoignable : seules les adresses et clés sont affichées.\n" +
        "Démarrez-le avec « npm run node » puis relancez « npm run accounts ».\n",
    );
  }

  console.log("==============================================================");
  console.log(" FreelanceTN — comptes Hardhat locaux (JAMAIS de fonds réels)");
  console.log("==============================================================");
  console.log(`chainId   : ${chainId}`);
  console.log(`bloc      : ${blockNumber}`);
  console.log(`comptes   : ${ACCOUNT_COUNT} dérivés du mnémonique de dev`);
  console.log(`RPC       : http://127.0.0.1:8545`);
  console.log("");

  for (let index = 0; index < ACCOUNT_COUNT; index += 1) {
    const wallet = ethers.HDNodeWallet.fromPhrase(
      MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${index}`,
    );

    let balance = "n/a";
    if (nodeReachable) {
      try {
        const value = await ethers.provider.getBalance(wallet.address);
        balance = `${ethers.formatEther(value)} ETH`;
      } catch {
        balance = "n/a";
      }
    }

    const role = ROLES[index] ? `  <-- ${ROLES[index]}` : "";
    console.log(`#${index}${role}`);
    console.log(`  adresse      : ${wallet.address}`);
    console.log(`  clé privée   : ${wallet.privateKey}`);
    console.log(`  solde        : ${balance}`);
    console.log("");
  }

  console.log(
    "Rappel : importez ces clés uniquement dans un MetaMask de test, sur le\n" +
      "réseau Hardhat Local (chainId 31337). Elles sont publiques et sans valeur.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
