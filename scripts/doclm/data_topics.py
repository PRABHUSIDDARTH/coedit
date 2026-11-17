"""Fixed input domains and fact pools for docLM data build, phase 1 (summarize, suggest_edits).

The topic list below is chosen by the data builder, NOT derived from the held-out set or from any
baseline result. It is written into docs/doclm/DATA_BUILD.md before any generation. Standard
library only.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

TOPICS: tuple[str, ...] = (
    "composting kitchen scraps at home",
    "a neighbourhood library changing its opening hours",
    "learning to cook rice properly",
    "commuting to work by bicycle",
    "a community garden starting its season",
    "saving money on weekly groceries",
    "a local bakery opening a second shop",
    "a city bus route being rescheduled",
    "looking after houseplants indoors",
    "a primary school science fair",
    "household recycling rules",
    "a weekend farmers market",
    "screen time and sleep for teenagers",
    "a power outage in a small town",
    "a charity fun run",
    "washing laundry with less water and energy",
    "a public park being renovated",
    "a family road trip across the country",
    "a repair cafe where neighbours fix broken items",
    "learning a musical instrument as an adult",
    "birdwatching in a backyard",
    "a town swimming pool reopening",
    "baking bread at home",
    "a lost-and-found service at a train station",
    "neighbourhood noise rules",
    "the history of a village clock tower",
    "daily walking for health",
    "renting a bicycle for a day",
    "a library book sale",
    "keeping winter heating costs down",
    "planning a child's birthday party",
    "a local football club's season",
    "tea and coffee habits",
    "a flood warning during heavy rain",
    "volunteering at an animal shelter",
    "a museum opening a new exhibit",
    "buying a used car",
    "an apartment building repairing its elevator",
    "returning items bought online",
    "a school lunch menu change",
)

GENRES: tuple[str, ...] = (
    "a short news item",
    "an explanatory paragraph",
    "a notice to residents",
    "a paragraph from a community newsletter",
    "a short blog-style paragraph",
    "a description of a local service",
)

FIRST_NAMES: tuple[str, ...] = (
    "Maya",
    "Daniel",
    "Priya",
    "Tomas",
    "Hannah",
    "Omar",
    "Lucia",
    "Kenji",
    "Grace",
    "Mateo",
    "Amara",
    "Peter",
    "Sofia",
    "Liam",
    "Nadia",
    "Felix",
    "Ingrid",
    "Rafael",
    "Zoe",
    "Hugo",
)
LAST_NAMES: tuple[str, ...] = (
    "Ortiz",
    "Bennett",
    "Rao",
    "Novak",
    "Fischer",
    "Haddad",
    "Moreau",
    "Tanaka",
    "Abbott",
    "Silva",
    "Okafor",
    "Lindqvist",
    "Costa",
    "Walsh",
    "Karimi",
    "Dubois",
    "Sorensen",
    "Mbeki",
    "Rossi",
    "Petrov",
)
MONTHS: tuple[str, ...] = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


@dataclass(frozen=True)
class FactSpec:
    """Facts the passage prompt asks the model to include verbatim (checked afterwards by code)."""

    person: str
    date: str  # "March 14, 2022"
    count: int
    percent: int

    def phrases(self) -> list[str]:
        return [self.person, self.date, str(self.count), f"{self.percent} percent"]


def make_spec(rng: random.Random) -> FactSpec:
    count = rng.randint(12, 480)
    percent = rng.randint(5, 90)
    while percent == count:
        percent = rng.randint(5, 90)
    date = f"{rng.choice(MONTHS)} {rng.randint(1, 28)}, {rng.randint(2018, 2024)}"
    return FactSpec(f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", date, count, percent)


def passage_plan(n: int, seed: int) -> list[tuple[str, str, FactSpec]]:
    """(topic, genre, facts) for passage 0..n-1: topics cycle through a seeded shuffle."""
    rng = random.Random(seed)  # noqa: S311 (seeded data sampling, not security)
    order = list(TOPICS)
    rng.shuffle(order)
    return [(order[i % len(order)], rng.choice(GENRES), make_spec(rng)) for i in range(n)]


def passage_prompt(
    topic: str, genre: str, spec: FactSpec, words: int = 130
) -> list[dict[str, str]]:
    """Generator prompt for a source passage. This is NOT an evaluation prompt."""
    user = (
        f"Write {genre} about {topic}, in plain prose, as ONE paragraph of about {words} words. "
        f"Mention {spec.person}, the date {spec.date}, the number {spec.count}, and the figure "
        f"{spec.percent} percent, each written exactly like that. Do not use lists, headings or "
        "markdown. Reply with the paragraph only."
    )
    return [{"role": "user", "content": user}]
