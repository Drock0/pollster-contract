/**
 * Pollster driver script
 *      -- run the script with --
 *  npx tsx x-temp/pollster-driver.ts
 *
 * or with options:
 *
 *  npx tsx x-temp/pollster-driver.ts --fast (ignores the delay time set)
 *  npx tsx x-temp/pollster-driver.ts --mode=counter (test counter increment)
 *  npx tsx x-temp/pollster-driver.ts --mode=decrement (test counter decrement)
 *  npx tsx x-temp/pollster-driver.ts --mode=create (create polls continuously)
 *  npx tsx x-temp/pollster-driver.ts --mode=vote (vote on existing polls)
 *  npx tsx x-temp/pollster-driver.ts --mode=full (create polls, vote, check status)
 *
 * - Reads the deployer "mnemonic" from settings/Mainnet.toml
 * - Derives the account private key
 * - Interacts with the deployed mainnet contract:
 *     SP237HRZEM03XCG4TJMYMBT0J0FPY90MS1HB48YTM.pollster
 * - Modes:
 *     counter: Continuously calls increment with random delays
 *     decrement: Continuously calls decrement with random delays
 *     create: Creates test polls with different topics
 *     vote: Votes on existing polls randomly
 *     full: Runs a mix of poll creation, voting, and status checks
 * - Waits a random interval between each call:
 *     30s, 45s, 1m, 1m15s, 1m30s, 1m45s, 3m
 *
 * Usage:
 *   - Ensure you have installed dependencies: npm install
 *   - Run with tsx
 *   - By default, this script resolves settings/Mainnet.toml relative to this file
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createNetwork, TransactionVersion } from "@stacks/network";
import {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  cvToString,
  uintCV,
  principalCV,
  stringAsciiCV,
  listCV,
} from "@stacks/transactions";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import * as TOML from "toml";

type NetworkSettings = {
  network?: {
    name?: string;
    stacks_node_rpc_address?: string;
    deployment_fee_rate?: number;
  };
  accounts?: {
    deployer?: {
      mnemonic?: string;
    };
  };
};

const CONTRACT_ADDRESS = "SP237HRZEM03XCG4TJMYMBT0J0FPY90MS1HB48YTM";
const CONTRACT_NAME = "pollster";

// Function names in pollster.clar
const FN_INCREMENT = "increment";
const FN_DECREMENT = "decrement";
const FN_CREATE_POLL = "create-poll";
const FN_VOTE = "vote";
const FN_CLOSE_POLL = "close-poll";
const FN_GET_COUNTER = "get-counter";
const FN_GET_POLL_INFO = "get-poll-info";
const FN_GET_OPTION_VOTES = "get-option-votes";
const FN_GET_OPTION_INFO = "get-option-info";
const FN_HAS_VOTED = "has-voted";
const FN_GET_TOTAL_POLLS = "get-total-polls";
const FN_GET_POLL_RESULTS = "get-poll-results";

// Reasonable default fee in microstacks for contract-call
const DEFAULT_FEE_USTX = 10000;

// Parse command-line arguments
const FAST = process.argv.includes("--fast");
const MODE =
  process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ||
  "counter";

// Random delay choices (milliseconds)
let DELAY_CHOICES_MS = [
  30_000, // 30 sec
  60_000, // 1 min
  45_000, // 45 sec
  105_000, // 1 min 45 sec
  75_000, // 1 min 15 sec
  90_000, // 1 min 30 sec
  180_000, // 3 min
];
if (FAST) {
  // Shorten delays for a quick smoke run
  DELAY_CHOICES_MS = [1_000, 2_000, 3_000, 5_000];
}

// Sample poll topics and options for testing
const SAMPLE_POLLS = [
  {
    title: "Favorite Programming Language?",
    options: ["JavaScript", "Python", "Rust", "Clarity"],
  },
  {
    title: "Best Blockchain?",
    options: ["Stacks", "Bitcoin", "Ethereum"],
  },
  {
    title: "Prefer Light or Dark Mode?",
    options: ["Light Mode", "Dark Mode", "Auto"],
  },
  {
    title: "Coffee or Tea?",
    options: ["Coffee", "Tea", "Neither"],
  },
  {
    title: "Cats or Dogs?",
    options: ["Cats", "Dogs", "Both", "Neither"],
  },
  {
    title: "Morning or Night Person?",
    options: ["Morning", "Night", "Afternoon"],
  },
];

// Helper to get current file dir (ESM-compatible)
function thisDirname(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.dirname(__filename);
}

async function readMainnetMnemonic(): Promise<string> {
  const baseDir = thisDirname();
  // Resolve ../settings/Mainnet.toml relative to this file
  const settingsPath = path.resolve(baseDir, "../settings/Mainnet.toml");

  const raw = await fs.readFile(settingsPath, "utf8");
  const parsed = TOML.parse(raw) as NetworkSettings;

  const mnemonic = parsed?.accounts?.deployer?.mnemonic;
  if (!mnemonic || mnemonic.includes("<YOUR PRIVATE MAINNET MNEMONIC HERE>")) {
    throw new Error(
      `Mnemonic not found in ${settingsPath}. Please set [accounts.deployer].mnemonic.`
    );
  }
  return mnemonic.trim();
}

async function deriveSenderFromMnemonic(mnemonic: string) {
  // Note: generateWallet accepts the 12/24-word secret phrase via "secretKey"
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: "",
  });
  const account = wallet.accounts[0];

  function normalizeSenderKey(key: string): string {
    let k = (key || "").trim();
    if (k.startsWith("0x") || k.startsWith("0X")) k = k.slice(2);
    return k;
  }

  const rawKey = account.stxPrivateKey || "";
  const senderKey = normalizeSenderKey(rawKey); // hex private key string, no 0x prefix

  const senderAddress = getStxAddress({
    account,
    transactionVersion: TransactionVersion.Mainnet,
  });

  // Debug: key length (do not print full key)
  console.log(
    `Derived sender key length: ${senderKey.length} hex chars (address: ${senderAddress})`
  );

  return { senderKey, senderAddress };
}

function pickRandomDelayMs(): number {
  const i = Math.floor(Math.random() * DELAY_CHOICES_MS.length);
  return DELAY_CHOICES_MS[i];
}

function pickRandomPoll() {
  const i = Math.floor(Math.random() * SAMPLE_POLLS.length);
  return SAMPLE_POLLS[i];
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort);
  });
}

async function readCounter(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_COUNTER,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readTotalPolls(network: any, senderAddress: string) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_TOTAL_POLLS,
    functionArgs: [],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readPollInfo(
  network: any,
  senderAddress: string,
  pollId: number
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_POLL_INFO,
    functionArgs: [uintCV(pollId)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readPollResults(
  network: any,
  senderAddress: string,
  pollId: number
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_POLL_RESULTS,
    functionArgs: [uintCV(pollId)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readOptionVotes(
  network: any,
  senderAddress: string,
  pollId: number,
  optionIndex: number
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_GET_OPTION_VOTES,
    functionArgs: [uintCV(pollId), uintCV(optionIndex)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function readHasVoted(
  network: any,
  senderAddress: string,
  pollId: number,
  userAddress: string
) {
  const res = await fetchCallReadOnlyFunction({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName: FN_HAS_VOTED,
    functionArgs: [uintCV(pollId), principalCV(userAddress)],
    network,
    senderAddress,
  });
  return cvToString(res);
}

async function contractCall(
  network: any,
  senderKey: string,
  functionName: string,
  functionArgs: any[] = []
) {
  console.log(
    `Preparing contract-call tx for: ${functionName}${
      functionArgs.length > 0 ? " with args" : ""
    }`
  );
  const tx = await makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    network,
    senderKey,
    fee: DEFAULT_FEE_USTX,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  // Defensive: ensure tx object is valid before broadcast
  if (!tx || typeof (tx as any).serialize !== "function") {
    throw new Error(
      `Invalid transaction object for ${functionName} (missing serialize).`
    );
  }

  try {
    const resp = await broadcastTransaction({ transaction: tx, network });
    const txid =
      typeof resp === "string"
        ? resp
        : (resp as any).txid ||
          (resp as any).transactionId ||
          (resp as any).txId ||
          (resp as any).tx_id ||
          "unknown-txid";
    console.log(`Broadcast response for ${functionName}: ${txid}`);
    return txid;
  } catch (e: any) {
    const reason =
      e?.message ||
      e?.response?.error ||
      e?.response?.reason ||
      e?.responseText ||
      "unknown-error";
    throw new Error(`Broadcast failed for ${functionName}: ${reason}`);
  }
}

async function runCounterMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in COUNTER mode: will increment counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_INCREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runDecrementMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log("Running in DECREMENT mode: will decrement counter continuously");
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;
    const functionName = FN_DECREMENT;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next call (${functionName})...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    console.log(`Calling ${functionName} (#${iteration})...`);
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, functionName);
        console.log(`Broadcasted ${functionName}: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for ${functionName}: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const current = await readCounter(network, senderAddress);
        console.log(`Current counter (read-only): ${current}`);
      } catch (re) {
        console.warn(
          `Warning: failed to read counter after ${functionName}:`,
          (re as Error).message
        );
      }
    }
  }
}

async function runCreateMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in CREATE mode: will create polls with various topics continuously"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before creating next poll...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Pick a random poll from samples
    const poll = pickRandomPoll();
    const optionCVs = poll.options.map((opt) => stringAsciiCV(opt));

    console.log(
      `Creating poll (#${iteration}): "${poll.title}" with ${poll.options.length} options`
    );
    console.log(`Options: ${poll.options.join(", ")}`);

    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, FN_CREATE_POLL, [
          stringAsciiCV(poll.title),
          listCV(optionCVs),
        ]);
        console.log(`Broadcasted create-poll: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for create-poll: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const totalPolls = await readTotalPolls(network, senderAddress);
        console.log(`Total polls after creation (read-only): ${totalPolls}`);
      } catch (re) {
        console.warn(
          "Warning: failed to read total polls after creation:",
          (re as Error).message
        );
      }
    }
  }
}

async function runVoteMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in VOTE mode: will vote on random existing polls continuously"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next vote...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Get total polls first
    let totalPolls = 0;
    try {
      const totalStr = await readTotalPolls(network, senderAddress);
      totalPolls = parseInt(totalStr.replace(/[^0-9]/g, "")) || 0;
      console.log(`Total polls available: ${totalPolls}`);
    } catch (e) {
      console.warn(
        "Warning: could not read total polls, skipping this iteration"
      );
      continue;
    }

    if (totalPolls === 0) {
      console.log("No polls exist yet. Create some polls first!");
      continue;
    }

    // Pick a random poll to vote on (poll IDs are 0-indexed)
    const pollId = Math.floor(Math.random() * totalPolls);

    // Get poll info to know how many options
    let optionCount = 2; // default
    try {
      const pollInfo = await readPollInfo(network, senderAddress, pollId);
      console.log(`Poll #${pollId} info: ${pollInfo}`);
      // Try to extract option-count from the response
      const match = pollInfo.match(/option-count:\s*u(\d+)/);
      if (match) {
        optionCount = parseInt(match[1]);
      }
    } catch (e) {
      console.warn(`Warning: could not read poll #${pollId} info`);
      continue;
    }

    // Check if we already voted
    try {
      const hasVoted = await readHasVoted(
        network,
        senderAddress,
        pollId,
        senderAddress
      );
      if (hasVoted.includes("true")) {
        console.log(
          `Already voted on poll #${pollId}, skipping to next poll...`
        );
        continue;
      }
    } catch (e) {
      console.warn(`Warning: could not check vote status for poll #${pollId}`);
    }

    // Pick a random option (0-indexed)
    const optionIndex = Math.floor(Math.random() * optionCount);

    console.log(
      `Voting (#${iteration}) on poll #${pollId}, option #${optionIndex}...`
    );
    let txid: string | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        txid = await contractCall(network, senderKey, FN_VOTE, [
          uintCV(pollId),
          uintCV(optionIndex),
        ]);
        console.log(`Broadcasted vote: ${txid}`);
        break;
      } catch (err) {
        const msg = (err as Error).message || String(err);
        console.warn(
          `Attempt ${attempt} failed for vote: ${msg}${
            attempt < 3 ? " — retrying..." : ""
          }`
        );
        if (attempt < 3) {
          try {
            await delay(2000 * attempt, stopSignal);
          } catch {
            keepRunning = false;
            break;
          }
        }
      }
    }

    if (txid) {
      try {
        const pollResults = await readPollResults(
          network,
          senderAddress,
          pollId
        );
        console.log(`Poll #${pollId} results after vote: ${pollResults}`);

        const optionVotes = await readOptionVotes(
          network,
          senderAddress,
          pollId,
          optionIndex
        );
        console.log(
          `Option #${optionIndex} votes in poll #${pollId}: ${optionVotes}`
        );
      } catch (re) {
        console.warn(
          "Warning: failed to read poll results after vote:",
          (re as Error).message
        );
      }
    }
  }
}

async function runFullMode(
  network: any,
  senderKey: string,
  senderAddress: string,
  stopSignal: AbortSignal
) {
  console.log(
    "Running in FULL mode: will create polls, vote, and check status periodically"
  );
  let keepRunning = true;
  let iteration = 0;

  stopSignal.addEventListener("abort", () => {
    keepRunning = false;
  });

  while (keepRunning) {
    iteration++;

    const waitMs = pickRandomDelayMs();
    const seconds = Math.round(waitMs / 1000);
    console.log(`Waiting ~${seconds}s before next action...`);
    try {
      await delay(waitMs, stopSignal);
    } catch {
      break;
    }

    // Alternate between creating polls, voting, and checking status
    const action = iteration % 3;

    if (action === 0) {
      // Create a poll
      const poll = pickRandomPoll();
      const optionCVs = poll.options.map((opt) => stringAsciiCV(opt));

      console.log(
        `Creating poll (#${iteration}): "${poll.title}" with ${poll.options.length} options`
      );

      let txid: string | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          txid = await contractCall(network, senderKey, FN_CREATE_POLL, [
            stringAsciiCV(poll.title),
            listCV(optionCVs),
          ]);
          console.log(`Broadcasted create-poll: ${txid}`);
          break;
        } catch (err) {
          const msg = (err as Error).message || String(err);
          console.warn(
            `Attempt ${attempt} failed for create-poll: ${msg}${
              attempt < 3 ? " — retrying..." : ""
            }`
          );
          if (attempt < 3) {
            try {
              await delay(2000 * attempt, stopSignal);
            } catch {
              keepRunning = false;
              break;
            }
          }
        }
      }
    } else if (action === 1) {
      // Vote on a random poll
      let totalPolls = 0;
      try {
        const totalStr = await readTotalPolls(network, senderAddress);
        totalPolls = parseInt(totalStr.replace(/[^0-9]/g, "")) || 0;
      } catch (e) {
        console.warn("Warning: could not read total polls");
      }

      if (totalPolls > 0) {
        const pollId = Math.floor(Math.random() * totalPolls);
        const optionIndex = Math.floor(Math.random() * 3); // Assume 3 options

        console.log(
          `Voting on poll #${pollId}, option #${optionIndex} (#${iteration})...`
        );

        try {
          const txid = await contractCall(network, senderKey, FN_VOTE, [
            uintCV(pollId),
            uintCV(optionIndex),
          ]);
          console.log(`Broadcasted vote: ${txid}`);
        } catch (err) {
          console.warn(`Vote failed: ${(err as Error).message}`);
        }
      } else {
        console.log("No polls exist yet to vote on.");
      }
    } else {
      // Check status
      try {
        const counter = await readCounter(network, senderAddress);
        const totalPolls = await readTotalPolls(network, senderAddress);
        console.log(`Status check (#${iteration}):`);
        console.log(`  Counter: ${counter}`);
        console.log(`  Total Polls: ${totalPolls}`);

        // Check first poll if exists
        const total = parseInt(totalPolls.replace(/[^0-9]/g, "")) || 0;
        if (total > 0) {
          const pollResults = await readPollResults(network, senderAddress, 0);
          console.log(`  Poll #0 Results: ${pollResults}`);
        }
      } catch (e) {
        console.warn("Warning: failed to read status:", (e as Error).message);
      }
    }
  }
}

async function main() {
  console.log("Pollster driver starting...");
  if (FAST) console.log("FAST mode enabled: shortened delays");
  console.log(`Mode: ${MODE}`);

  // 1) Network
  const network = createNetwork("mainnet");

  // 2) Load mnemonic and derive sender
  const mnemonic = await readMainnetMnemonic();
  const { senderKey, senderAddress } = await deriveSenderFromMnemonic(mnemonic);

  console.log(`Using sender address: ${senderAddress}`);
  console.log(
    `Target contract: ${CONTRACT_ADDRESS}.${CONTRACT_NAME} (mainnet)`
  );

  // 3) Continuous run based on mode
  const stopController = new AbortController();
  const stopSignal = stopController.signal;
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT. Stopping now...");
    stopController.abort();
  });

  try {
    if (MODE === "counter") {
      await runCounterMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "decrement") {
      await runDecrementMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "create") {
      await runCreateMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "vote") {
      await runVoteMode(network, senderKey, senderAddress, stopSignal);
    } else if (MODE === "full") {
      await runFullMode(network, senderKey, senderAddress, stopSignal);
    } else {
      throw new Error(
        `Unknown mode: ${MODE}. Use --mode=counter, --mode=decrement, --mode=create, --mode=vote, or --mode=full`
      );
    }
  } catch (e) {
    if ((e as Error).message !== "aborted") {
      throw e;
    }
  }

  // Final status check
  try {
    const finalCounter = await readCounter(network, senderAddress);
    const finalTotalPolls = await readTotalPolls(network, senderAddress);
    console.log(`\nFinal status:`);
    console.log(`  Counter: ${finalCounter}`);
    console.log(`  Total Polls: ${finalTotalPolls}`);

    const total = parseInt(finalTotalPolls.replace(/[^0-9]/g, "")) || 0;
    if (total > 0) {
      console.log(`\nRecent poll info:`);
      const lastPollId = total - 1;
      const pollInfo = await readPollInfo(network, senderAddress, lastPollId);
      console.log(`  Poll #${lastPollId}: ${pollInfo}`);
    }
  } catch (e) {
    console.warn("Warning: failed to read final status:", (e as Error).message);
  }
  console.log("Pollster driver stopped.");
}

// Run
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
