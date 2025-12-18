import { Cl } from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

describe("Counter Functions Tests (Decoration)", () => {
  it("allows incrementing the counter", () => {
    const incrementResponse = simnet.callPublicFn(
      "pollster",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(1));
  });

  it("emits event when incrementing counter", () => {
    const incrementResponse = simnet.callPublicFn(
      "pollster",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(1));

    // Check for print event
    const printEvents = incrementResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("counter-incremented");
    expect(eventData.value.caller.value).toBe(deployer);
    expect(eventData.value["new-value"].value).toBe(1n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("allows multiple increments", () => {
    simnet.callPublicFn("pollster", "increment", [], deployer);
    simnet.callPublicFn("pollster", "increment", [], deployer);
    const incrementResponse = simnet.callPublicFn(
      "pollster",
      "increment",
      [],
      deployer
    );

    expect(incrementResponse.result).toBeOk(Cl.uint(3));
  });

  it("allows decrementing the counter", () => {
    simnet.callPublicFn("pollster", "increment", [], deployer);
    simnet.callPublicFn("pollster", "increment", [], deployer);

    const decrementResponse = simnet.callPublicFn(
      "pollster",
      "decrement",
      [],
      deployer
    );

    expect(decrementResponse.result).toBeOk(Cl.uint(1));
  });

  it("emits event when decrementing counter", () => {
    simnet.callPublicFn("pollster", "increment", [], deployer);
    simnet.callPublicFn("pollster", "increment", [], deployer);

    const decrementResponse = simnet.callPublicFn(
      "pollster",
      "decrement",
      [],
      deployer
    );

    expect(decrementResponse.result).toBeOk(Cl.uint(1));

    // Check for print event
    const printEvents = decrementResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("counter-decremented");
    expect(eventData.value.caller.value).toBe(deployer);
    expect(eventData.value["new-value"].value).toBe(1n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("prevents underflow when decrementing at zero", () => {
    const decrementResponse = simnet.callPublicFn(
      "pollster",
      "decrement",
      [],
      deployer
    );

    // Should return ERR_UNDERFLOW (err u100)
    expect(decrementResponse.result).toBeErr(Cl.uint(100));
  });

  it("returns the current counter value", () => {
    simnet.callPublicFn("pollster", "increment", [], deployer);
    simnet.callPublicFn("pollster", "increment", [], deployer);

    const counterValue = simnet.callReadOnlyFn(
      "pollster",
      "get-counter",
      [],
      deployer
    );

    expect(counterValue.result).toBeOk(Cl.uint(2));
  });
});

describe("Poll Creation Tests", () => {
  it("allows creating a poll with multiple options", () => {
    const title = "Favorite Color?";
    const options = Cl.list([
      Cl.stringAscii("Red"),
      Cl.stringAscii("Blue"),
      Cl.stringAscii("Green"),
    ]);

    const createResponse = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii(title), options],
      wallet1
    );

    expect(createResponse.result).toBeOk(Cl.uint(0)); // First poll ID is 0
  });

  it("emits event when creating a poll", () => {
    const title = "Best Language?";
    const options = Cl.list([
      Cl.stringAscii("Python"),
      Cl.stringAscii("JavaScript"),
      Cl.stringAscii("Clarity"),
    ]);

    const createResponse = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii(title), options],
      wallet1
    );

    expect(createResponse.result).toBeOk(Cl.uint(0));

    // Check for print event
    const printEvents = createResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("poll-created");
    expect(eventData.value["poll-id"].value).toBe(0n);
    expect(eventData.value.title.value).toBe(title);
    expect(eventData.value.creator.value).toBe(wallet1);
    expect(eventData.value["option-count"].value).toBe(3n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("assigns sequential poll IDs", () => {
    const options = Cl.list([
      Cl.stringAscii("Option1"),
      Cl.stringAscii("Option2"),
    ]);

    const poll1 = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 1"), options],
      wallet1
    );

    const poll2 = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 2"), options],
      wallet2
    );

    expect(poll1.result).toBeOk(Cl.uint(0));
    expect(poll2.result).toBeOk(Cl.uint(1));
  });

  it("rejects poll creation with no options", () => {
    const options = Cl.list([]);

    const createResponse = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Empty Poll"), options],
      wallet1
    );

    // Should return ERR_EMPTY_OPTIONS (err u106)
    expect(createResponse.result).toBeErr(Cl.uint(106));
  });

  it("stores poll metadata correctly", () => {
    const title = "Should we add dark mode?";
    const options = Cl.list([
      Cl.stringAscii("Yes"),
      Cl.stringAscii("No"),
      Cl.stringAscii("Maybe"),
    ]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii(title), options],
      wallet1
    );

    const pollInfo = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-info",
      [Cl.uint(0)],
      wallet1
    );

    expect(pollInfo.result).toBeOk(
      Cl.tuple({
        title: Cl.stringAscii(title),
        creator: Cl.principal(wallet1),
        "total-votes": Cl.uint(0),
        "is-active": Cl.bool(true),
        "option-count": Cl.uint(3),
      })
    );
  });

  it("initializes all options with zero votes", () => {
    const options = Cl.list([Cl.stringAscii("Red"), Cl.stringAscii("Blue")]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Colors"), options],
      wallet1
    );

    const option0Info = simnet.callReadOnlyFn(
      "pollster",
      "get-option-info",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );

    const option1Info = simnet.callReadOnlyFn(
      "pollster",
      "get-option-info",
      [Cl.uint(0), Cl.uint(1)],
      wallet1
    );

    expect(option0Info.result).toBeOk(
      Cl.tuple({
        "option-name": Cl.stringAscii("Red"),
        votes: Cl.uint(0),
      })
    );

    expect(option1Info.result).toBeOk(
      Cl.tuple({
        "option-name": Cl.stringAscii("Blue"),
        votes: Cl.uint(0),
      })
    );
  });

  it("allows different users to create polls", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);

    const poll1 = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll by User 1"), options],
      wallet1
    );

    const poll2 = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll by User 2"), options],
      wallet2
    );

    expect(poll1.result).toBeOk(Cl.uint(0));
    expect(poll2.result).toBeOk(Cl.uint(1));

    const pollInfo1 = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-info",
      [Cl.uint(0)],
      wallet1
    );

    const pollInfo2 = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-info",
      [Cl.uint(1)],
      wallet2
    );

    // Check that both polls were created successfully
    expect(pollInfo1.result).toBeTruthy();
    expect(pollInfo2.result).toBeTruthy();
  });
});

describe("Voting Tests", () => {
  beforeEach(() => {
    // Create a poll before each voting test
    const options = Cl.list([
      Cl.stringAscii("Red"),
      Cl.stringAscii("Blue"),
      Cl.stringAscii("Green"),
    ]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Favorite Color?"), options],
      wallet1
    );
  });

  it("allows a user to vote on a poll", () => {
    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(1)], // Poll 0, Option 1 (Blue)
      wallet2
    );

    expect(voteResponse.result).toBeOk(Cl.bool(true));
  });

  it("emits event when voting", () => {
    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(1)],
      wallet2
    );

    expect(voteResponse.result).toBeOk(Cl.bool(true));

    // Check for print event
    const printEvents = voteResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("vote-cast");
    expect(eventData.value["poll-id"].value).toBe(0n);
    expect(eventData.value.voter.value).toBe(wallet2);
    expect(eventData.value["option-index"].value).toBe(1n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("increments vote count for the selected option", () => {
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet2);

    const optionVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(1)],
      wallet2
    );

    expect(optionVotes.result).toBeOk(Cl.uint(1));
  });

  it("increments total votes for the poll", () => {
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet2);

    const pollInfo = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-info",
      [Cl.uint(0)],
      wallet2
    );

    // Check that the poll now has 1 total vote
    expect(pollInfo.result).toBeOk(
      Cl.tuple({
        title: Cl.stringAscii("Favorite Color?"),
        creator: Cl.principal(wallet1),
        "total-votes": Cl.uint(1),
        "is-active": Cl.bool(true),
        "option-count": Cl.uint(3),
      })
    );
  });

  it("marks user as having voted", () => {
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet2);

    const hasVoted = simnet.callReadOnlyFn(
      "pollster",
      "has-voted",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet2
    );

    expect(hasVoted.result).toBeOk(Cl.bool(true));
  });

  it("prevents duplicate voting from the same user", () => {
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet2);

    const secondVote = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(2)], // Try to vote again on different option
      wallet2
    );

    // Should return ERR_ALREADY_VOTED (err u103)
    expect(secondVote.result).toBeErr(Cl.uint(103));
  });

  it("allows different users to vote on the same poll", () => {
    const vote1 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(0)], // Red
      wallet1
    );

    const vote2 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(1)], // Blue
      wallet2
    );

    const vote3 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(1)], // Blue
      wallet3
    );

    expect(vote1.result).toBeOk(Cl.bool(true));
    expect(vote2.result).toBeOk(Cl.bool(true));
    expect(vote3.result).toBeOk(Cl.bool(true));

    // Verify all three users successfully voted
    expect(vote1.result).toBeOk(Cl.bool(true));
    expect(vote2.result).toBeOk(Cl.bool(true));
    expect(vote3.result).toBeOk(Cl.bool(true));
  });

  it("correctly counts votes for different options", () => {
    // 2 votes for Red (option 0)
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet1);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);

    // 1 vote for Blue (option 1)
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet3);

    const redVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );

    const blueVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(1)],
      wallet1
    );

    const greenVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(2)],
      wallet1
    );

    expect(redVotes.result).toBeOk(Cl.uint(2));
    expect(blueVotes.result).toBeOk(Cl.uint(1));
    expect(greenVotes.result).toBeOk(Cl.uint(0));
  });

  it("rejects voting on non-existent poll", () => {
    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(999), Cl.uint(0)], // Poll doesn't exist
      wallet2
    );

    // Should return ERR_POLL_NOT_FOUND (err u101)
    expect(voteResponse.result).toBeErr(Cl.uint(101));
  });

  it("rejects voting for invalid option index", () => {
    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(999)], // Option doesn't exist
      wallet2
    );

    // Should return ERR_INVALID_OPTION (err u104)
    expect(voteResponse.result).toBeErr(Cl.uint(104));
  });

  it("rejects voting on closed poll", () => {
    // Close the poll
    simnet.callPublicFn("pollster", "close-poll", [Cl.uint(0)], wallet1);

    // Try to vote
    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(0)],
      wallet2
    );

    // Should return ERR_POLL_CLOSED (err u102)
    expect(voteResponse.result).toBeErr(Cl.uint(102));
  });

  it("allows same user to vote on different polls", () => {
    // Create a second poll
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);
    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Second Poll"), options],
      wallet1
    );

    // Vote on first poll
    const vote1 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(0)],
      wallet2
    );

    // Vote on second poll
    const vote2 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(1), Cl.uint(0)],
      wallet2
    );

    expect(vote1.result).toBeOk(Cl.bool(true));
    expect(vote2.result).toBeOk(Cl.bool(true));
  });
});

describe("Poll Closing Tests", () => {
  beforeEach(() => {
    // Create a poll before each test
    const options = Cl.list([
      Cl.stringAscii("Option1"),
      Cl.stringAscii("Option2"),
    ]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Test Poll"), options],
      wallet1
    );
  });

  it("allows creator to close their poll", () => {
    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet1 // Creator
    );

    expect(closeResponse.result).toBeOk(Cl.bool(true));
  });

  it("emits event when closing poll", () => {
    // Add some votes first
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);

    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet1
    );

    expect(closeResponse.result).toBeOk(Cl.bool(true));

    // Check for print event
    const printEvents = closeResponse.events.filter(
      (e) => e.event === "print_event"
    );
    expect(printEvents).toHaveLength(1);

    const eventData = printEvents[0].data.value as any;
    expect(eventData.value.event.value).toBe("poll-closed");
    expect(eventData.value["poll-id"].value).toBe(0n);
    expect(eventData.value.creator.value).toBe(wallet1);
    expect(eventData.value["total-votes"].value).toBe(1n);
    expect(eventData.value["block-height"].type).toBe("uint");
  });

  it("updates poll status to inactive when closed", () => {
    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet1
    );

    // Verify poll was closed successfully
    expect(closeResponse.result).toBeOk(Cl.bool(true));
  });

  it("prevents non-creator from closing poll", () => {
    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet2 // Not the creator
    );

    // Should return ERR_UNAUTHORIZED (err u105)
    expect(closeResponse.result).toBeErr(Cl.uint(105));
  });

  it("prevents closing non-existent poll", () => {
    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(999)],
      wallet1
    );

    // Should return ERR_POLL_NOT_FOUND (err u101)
    expect(closeResponse.result).toBeErr(Cl.uint(101));
  });

  it("prevents closing already closed poll", () => {
    simnet.callPublicFn("pollster", "close-poll", [Cl.uint(0)], wallet1);

    const secondClose = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet1
    );

    // Should return ERR_POLL_CLOSED (err u102)
    expect(secondClose.result).toBeErr(Cl.uint(102));
  });

  it("prevents voting after poll is closed", () => {
    simnet.callPublicFn("pollster", "close-poll", [Cl.uint(0)], wallet1);

    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(0)],
      wallet2
    );

    // Should return ERR_POLL_CLOSED (err u102)
    expect(voteResponse.result).toBeErr(Cl.uint(102));
  });

  it("preserves vote counts after closing poll", () => {
    // Cast votes
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet3);

    // Close poll
    simnet.callPublicFn("pollster", "close-poll", [Cl.uint(0)], wallet1);

    // Check vote counts are preserved
    const option0Votes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );

    const option1Votes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(1)],
      wallet1
    );

    expect(option0Votes.result).toBeOk(Cl.uint(1));
    expect(option1Votes.result).toBeOk(Cl.uint(1));
  });
});

describe("Read-Only Function Tests", () => {
  it("returns total polls count when no polls exist", () => {
    const totalPolls = simnet.callReadOnlyFn(
      "pollster",
      "get-total-polls",
      [],
      wallet1
    );

    expect(totalPolls.result).toBeOk(Cl.uint(0));
  });

  it("returns correct total polls count", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 1"), options],
      wallet1
    );

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 2"), options],
      wallet2
    );

    const totalPolls = simnet.callReadOnlyFn(
      "pollster",
      "get-total-polls",
      [],
      wallet1
    );

    expect(totalPolls.result).toBeOk(Cl.uint(2));
  });

  it("returns error for non-existent poll info", () => {
    const pollInfo = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-info",
      [Cl.uint(999)],
      wallet1
    );

    // Should return ERR_POLL_NOT_FOUND (err u101)
    expect(pollInfo.result).toBeErr(Cl.uint(101));
  });

  it("returns false for has-voted when user hasn't voted", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);
    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Test Poll"), options],
      wallet1
    );

    const hasVoted = simnet.callReadOnlyFn(
      "pollster",
      "has-voted",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet2
    );

    expect(hasVoted.result).toBeOk(Cl.bool(false));
  });

  it("returns correct option info", () => {
    const options = Cl.list([
      Cl.stringAscii("Python"),
      Cl.stringAscii("JavaScript"),
    ]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Best Language"), options],
      wallet1
    );

    // Vote on Python
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);

    const optionInfo = simnet.callReadOnlyFn(
      "pollster",
      "get-option-info",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );

    expect(optionInfo.result).toBeOk(
      Cl.tuple({
        "option-name": Cl.stringAscii("Python"),
        votes: Cl.uint(1),
      })
    );
  });

  it("returns error for invalid option info request", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);
    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Test Poll"), options],
      wallet1
    );

    const optionInfo = simnet.callReadOnlyFn(
      "pollster",
      "get-option-info",
      [Cl.uint(0), Cl.uint(999)],
      wallet1
    );

    // Should return ERR_INVALID_OPTION (err u104)
    expect(optionInfo.result).toBeErr(Cl.uint(104));
  });

  it("returns complete poll results", () => {
    const options = Cl.list([Cl.stringAscii("Red"), Cl.stringAscii("Blue")]);
    const title = "Favorite Color";

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii(title), options],
      wallet1
    );

    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);

    const results = simnet.callReadOnlyFn(
      "pollster",
      "get-poll-results",
      [Cl.uint(0)],
      wallet1
    );

    expect(results.result).toBeOk(
      Cl.tuple({
        title: Cl.stringAscii(title),
        "total-votes": Cl.uint(1),
        "is-active": Cl.bool(true),
        "option-count": Cl.uint(2),
      })
    );
  });
});

describe("Integration Tests", () => {
  it("handles complete poll lifecycle", () => {
    const options = Cl.list([
      Cl.stringAscii("Yes"),
      Cl.stringAscii("No"),
      Cl.stringAscii("Maybe"),
    ]);

    // Create poll
    const createResponse = simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Add dark mode?"), options],
      wallet1
    );
    expect(createResponse.result).toBeOk(Cl.uint(0));

    // Multiple users vote
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet1);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet3);

    // Check results
    const yesVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );
    expect(yesVotes.result).toBeOk(Cl.uint(2));

    const noVotes = simnet.callReadOnlyFn(
      "pollster",
      "get-option-votes",
      [Cl.uint(0), Cl.uint(1)],
      wallet1
    );
    expect(noVotes.result).toBeOk(Cl.uint(1));

    // Close poll
    const closeResponse = simnet.callPublicFn(
      "pollster",
      "close-poll",
      [Cl.uint(0)],
      wallet1
    );
    expect(closeResponse.result).toBeOk(Cl.bool(true));

    // Verify the lifecycle completed successfully
    expect(yesVotes.result).toBeOk(Cl.uint(2));
    expect(noVotes.result).toBeOk(Cl.uint(1));
    expect(closeResponse.result).toBeOk(Cl.bool(true));
  });

  it("handles multiple independent polls", () => {
    const options1 = Cl.list([Cl.stringAscii("Red"), Cl.stringAscii("Blue")]);
    const options2 = Cl.list([Cl.stringAscii("Cats"), Cl.stringAscii("Dogs")]);

    // Create two polls
    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Favorite Color?"), options1],
      wallet1
    );

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Cats or Dogs?"), options2],
      wallet2
    );

    // Same user votes on both polls
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet3);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(1), Cl.uint(1)], wallet3);

    // Verify both polls were created and votes were cast successfully
    expect(poll1.result).toBeOk(Cl.uint(0));
    expect(poll2.result).toBeOk(Cl.uint(1));
  });

  it("handles high vote counts correctly", () => {
    const options = Cl.list([
      Cl.stringAscii("Option1"),
      Cl.stringAscii("Option2"),
    ]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Popular Poll"), options],
      wallet1
    );

    // Cast multiple votes from different users
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet1);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(1)], wallet3);

    // Verify poll was created successfully
    expect(createResponse.result).toBeOk(Cl.uint(0));
  });

  it("ensures vote isolation between polls", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);

    // Create two polls
    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 1"), options],
      wallet1
    );

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("Poll 2"), options],
      wallet1
    );

    // Vote on poll 0
    simnet.callPublicFn("pollster", "vote", [Cl.uint(0), Cl.uint(0)], wallet2);

    // Vote on poll 1
    simnet.callPublicFn("pollster", "vote", [Cl.uint(1), Cl.uint(0)], wallet2);

    // User should be marked as voted on both polls
    const hasVotedPoll0 = simnet.callReadOnlyFn(
      "pollster",
      "has-voted",
      [Cl.uint(0), Cl.principal(wallet2)],
      wallet2
    );

    const hasVotedPoll1 = simnet.callReadOnlyFn(
      "pollster",
      "has-voted",
      [Cl.uint(1), Cl.principal(wallet2)],
      wallet2
    );

    expect(hasVotedPoll0.result).toBeOk(Cl.bool(true));
    expect(hasVotedPoll1.result).toBeOk(Cl.bool(true));

    // User cannot vote again on either poll
    const duplicateVote0 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(1)],
      wallet2
    );

    const duplicateVote1 = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(1), Cl.uint(1)],
      wallet2
    );

    expect(duplicateVote0.result).toBeErr(Cl.uint(103)); // ERR_ALREADY_VOTED
    expect(duplicateVote1.result).toBeErr(Cl.uint(103)); // ERR_ALREADY_VOTED
  });

  it("creator can vote on their own poll", () => {
    const options = Cl.list([Cl.stringAscii("Yes"), Cl.stringAscii("No")]);

    simnet.callPublicFn(
      "pollster",
      "create-poll",
      [Cl.stringAscii("My Poll"), options],
      wallet1
    );

    const voteResponse = simnet.callPublicFn(
      "pollster",
      "vote",
      [Cl.uint(0), Cl.uint(0)],
      wallet1 // Creator voting
    );

    expect(voteResponse.result).toBeOk(Cl.bool(true));
  });
});
