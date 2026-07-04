import { Label } from "./types";

/** First and last name pools for a position. Kept separate so a player's name
 * can be built from a random first + a random (different) last, producing a
 * novel positional name rather than a real player's exact name. */
type NamePool = { first: string[]; last: string[] };

// Wide receivers — shared by both outside receiver labels (XR, ZR)
const WR: NamePool = {
  first: [
    "Jerry", "Randy", "Calvin", "Larry", "Antonio", "Julio", "Terrell",
    "Tyreek", "Justin", "Davante", "DeAndre", "Marvin", "Steve", "Andre",
    "Cooper", "Odell",
  ],
  last: [
    "Rice", "Moss", "Johnson", "Fitzgerald", "Brown", "Jones", "Owens",
    "Hill", "Jefferson", "Adams", "Hopkins", "Harrison", "Smith", "Johnson",
    "Kupp", "Beckham",
  ],
};

// Cornerbacks — shared by boundary corner (CB) and nickel back (NB)
const CB: NamePool = {
  first: [
    "Deion", "Darrelle", "Richard", "Charles", "Champ", "Jalen", "Patrick",
    "Stephon", "Aqib", "Chris", "Sauce", "Nnamdi", "Darius", "Marcus", "Joe",
    "Josh",
  ],
  last: [
    "Sanders", "Revis", "Sherman", "Woodson", "Bailey", "Ramsey", "Peterson",
    "Gilmore", "Talib", "Harris", "Gardner", "Asomugha", "Slay", "Peters",
    "Haden", "Norman",
  ],
};

/** First/last name pools keyed by the in-game player label. */
export const NAME_POOLS: Record<Label, NamePool> = {
  QB: {
    first: ["Tom", "Patrick", "Peyton", "Aaron", "Drew", "Ben", "Joe", "Brett"],
    last: [
      "Brady", "Mahomes", "Manning", "Rodgers", "Brees", "Roethlisberger",
      "Montana", "Favre",
    ],
  },
  RB: {
    first: [
      "Adrian", "LaDainian", "Marshawn", "Derrick", "Emmitt", "Barry",
      "Christian", "Frank",
    ],
    last: [
      "Peterson", "Tomlinson", "Lynch", "Henry", "Smith", "Sanders",
      "McCaffrey", "Gore",
    ],
  },
  TE: {
    first: ["Rob", "Travis", "Antonio", "Tony", "Jason", "Jimmy", "Greg", "George"],
    last: [
      "Gronkowski", "Kelce", "Gates", "Gonzalez", "Witten", "Graham", "Olsen",
      "Kittle",
    ],
  },
  LT: {
    first: ["Joe", "Trent", "Tyron", "Quenton", "Jonathan", "Walter", "Steve", "Anthony"],
    last: [
      "Thomas", "Williams", "Smith", "Nelson", "Ogden", "Jones", "Hutchinson",
      "Muñoz",
    ],
  },
  C: {
    first: ["Jason", "Maurkice", "Travis", "Nick", "Alex", "Rodney", "Jeff", "Creed"],
    last: [
      "Kelce", "Pouncey", "Frederick", "Mangold", "Mack", "Hudson", "Saturday",
      "Humphrey",
    ],
  },
  RT: {
    first: ["Zack", "Lane", "Marshal", "Jahri", "David", "Mitchell", "Brandon", "Larry"],
    last: [
      "Martin", "Johnson", "Yanda", "Evans", "DeCastro", "Schwartz", "Brooks",
      "Allen",
    ],
  },
  LE: {
    first: ["J.J.", "T.J.", "Khalil", "Von", "Reggie", "Michael", "Julius", "Maxx"],
    last: ["Watt", "Watt", "Mack", "Miller", "White", "Strahan", "Peppers", "Crosby"],
  },
  DT: {
    first: ["Aaron", "Chris", "Fletcher", "Ndamukong", "Geno", "Vince", "Gerald", "Warren"],
    last: ["Donald", "Jones", "Cox", "Suh", "Atkins", "Wilfork", "McCoy", "Sapp"],
  },
  RE: {
    first: ["Myles", "Nick", "DeMarcus", "Lawrence", "Bruce", "Jared", "Chandler", "Justin"],
    last: ["Garrett", "Bosa", "Ware", "Taylor", "Smith", "Allen", "Jones", "Houston"],
  },
  LB: {
    first: ["Ray", "Luke", "Bobby", "Patrick", "Brian", "Fred", "Lavonte", "NaVorro"],
    last: ["Lewis", "Kuechly", "Wagner", "Willis", "Urlacher", "Warner", "David", "Bowman"],
  },
  FS: {
    first: ["Ed", "Earl", "Tyrann", "Minkah", "Eric", "Devin", "Sean", "Justin"],
    last: ["Reed", "Thomas", "Mathieu", "Fitzpatrick", "Weddle", "McCourty", "Taylor", "Simmons"],
  },
  SS: {
    first: ["Troy", "Kam", "Harrison", "Jamal", "Derwin", "Budda", "Landon", "Malcolm"],
    last: ["Polamalu", "Chancellor", "Smith", "Adams", "James", "Baker", "Collins", "Jenkins"],
  },
  XR: WR,
  ZR: WR,
  CB: CB,
  NB: CB,
};

/** Builds a positional name: a random first name paired with a last name from a
 * different entry (so it never reproduces a real player's exact name). */
export function generatePlayerName(label: Label): string {
  const pool = NAME_POOLS[label];
  const firstIdx = Math.floor(Math.random() * pool.first.length);

  let lastIdx = Math.floor(Math.random() * pool.last.length);
  while (pool.last.length > 1 && lastIdx === firstIdx) {
    lastIdx = Math.floor(Math.random() * pool.last.length);
  }

  return `${pool.first[firstIdx]} ${pool.last[lastIdx]}`;
}
