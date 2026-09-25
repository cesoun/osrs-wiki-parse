const axios = require('axios');
const fs = require('fs');
const xray = require('x-ray')({
	filters: {
		quest_req: (value) => {
			let req = value.split('-');

			// Join quests that have a '-' in their name. (RFD, Fairytale, ...)
			if (req.length === 3) {
				req = [req[0], req.slice(1).join('-')]
			}

			// If the quest contains a *, we'll split it here to determine boostable length.
			req = [
				Number(req[0].replace(' ', '')),
				...req[1].replace(/^\s+|\s+$/g, '').split('*'),
			];

			return {
				level: req[0],
				quest: req[1],
				boostable: req.length === 3,
			};
		},
	},
});

// Wiki API base with string replace tags.
const API_BASE_URI =
	'https://oldschool.runescape.wiki/api.php?action=parse&page={PAGE_NAME}&format=json';
const API_QUERY_SECTION = '&section={SECTION_NUM}';

// Placeholders for replacement.
const PAGE_NAME_PLACEHOLDER = '{PAGE_NAME}';
const SECTION_NUMBER_PLACEHOLDER = '{SECTION_NUM}';

// Guide identifier.
const GUIDE_PAGE = 'Optimal_quest_guide';
const GUIDE_SECTION_IDX = 2;

// Define the current quest requirements page.
const SKILL_REQUIREMENTS_PAGE = 'Quests/Requirements_by_skill';

// Entrypoint
(async () => {
	let quests = await parseGuide();
	let requirements = await parseRequirements();

	// Normalise quest names before matching requirements.
	quests.forEach((quest) => {
		quest.name = fixQuestNames(quest.name);
	});

	for (const req of requirements) {
		for (const questReq of req.quests) {
			questReq.quest = fixQuestNames(questReq.quest);
		}
	}

	let populatedQuests = quests.map((quest) => {
		// Loop through all requirements.
		for (const req of requirements) {
			// Check the requiremets for the given quest.
			for (const questReq of req.quests) {
				if (questReq.quest === quest.name) {
					quest.reqs.push({
						skill: req.skill,
						level: questReq.level,
						boostable: questReq.boostable,
					});
				}
			}
		}

		return quest;
	});


	await fs.writeFile('./quests.json', JSON.stringify(populatedQuests, null, 4), err => {
		if (err) {
			console.error(err)
		} else {
			console.log('quests.json written to disk')
		}
	});
})();

// parse: Optimal_quest_guide
async function parseGuide() {
	console.log('parsing quests');

	// Setup uri
	const guidePageURI = API_BASE_URI.replace(
		PAGE_NAME_PLACEHOLDER,
		GUIDE_PAGE
	).concat(
		API_QUERY_SECTION.replace(SECTION_NUMBER_PLACEHOLDER, GUIDE_SECTION_IDX)
	);

	// GET
	let html = await getRequestHTML(guidePageURI);

	// Extract quests.
	let tbodies = await xray(html, 'tbody', {
		quests: ['tr[data-rowid] td:nth-child(1) a@title'],
		uris: ['tr[data-rowid] td:nth-child(1) a@href'],
		// Need to figure out how to fallback a value or just merge them down later. Not a priority atm.
		// quick: ['tr td:nth-child(2) a@href'],
	});

	// Map them to object structure. {name, uri, reqs[]}
	let quests = tbodies.quests.map((quest) => {
		let whitelist = [
			'The Grand Tree',
			'Defender of Varrock'
		];

		let blacklist = [
			'diary',
			'achievement',
			'unlock',
			'Stronghold of Security',
			'Natural history quiz',
			'Kudos',
			'Varrock Museum',
			'Balloon transport system',
			'Crafting Guild',
			'Varrock',
			'Museum Camp',
			'Castle Wars',
			'Grand Tree',
		];

		// Ignore overlapping 'whitelist' quests.
		if (!whitelist.includes(quest)) {
			for (const word of blacklist) {
				if (quest.toLowerCase().includes(word.toLowerCase())) return;
			}
		}

		return {
			name: quest.includes('/') ? quest.replace('/', ' - ') : quest,
			uri: `https://oldschool.runescape.wiki/w/${quest.replaceAll(' ', '_')}`,
			reqs: [],
		};
	});

	// remove undefined(s)
	return quests.filter((quest) => quest);
}

// fix quest names and adjust RFD names to match RuneLite API.
function fixQuestNames(quest) {
	const RUNELITE_RFD_QUEST_NAMES = {
		"Another Cook's Quest": "Another Cook's Quest",
		"Freeing the Goblin generals": "Wartface & Bentnoze",
		"Freeing the Mountain Dwarf": "Mountain Dwarf",
		"Freeing Evil Dave": "Evil Dave",
		"Freeing Pirate Pete": "Pirate Pete",
		"Freeing the Lumbridge Guide": "Lumbridge Guide",
		"Freeing Skrach Uglogwee": "Skrach Uglogwee",
		"Freeing Sir Amik Varze": "Sir Amik Varze",
		"Freeing King Awowogei": "King Awowogei",
		"Defeating the Culinaromancer": "Culinaromancer"
	};

	// Current OSRS Wiki format:
	// Recipe for Disaster/Freeing King Awowogei
	if (quest.startsWith('Recipe for Disaster/')) {
		const subquest = quest.substring('Recipe for Disaster/'.length);

		if (RUNELITE_RFD_QUEST_NAMES[subquest]) {
			return `Recipe for Disaster - ${RUNELITE_RFD_QUEST_NAMES[subquest]}`;
		}
	}

	// Older Wiki format retained for compatibility:
	// Recipe for Disaster - Freeing King Awowogei
	const subquest = quest.split(' - ');

	if (
		subquest.length === 2 &&
		subquest[0].includes('Recipe') &&
		RUNELITE_RFD_QUEST_NAMES[subquest[1]]
	) {
		subquest[1] = RUNELITE_RFD_QUEST_NAMES[subquest[1]];
		return subquest.join(' - ');
	}

	return quest;
}

// Parse quest skill requirements.
async function parseRequirements() {
	const cheerio = require('cheerio');

	const pageURI = API_BASE_URI.replace(
		PAGE_NAME_PLACEHOLDER,
		SKILL_REQUIREMENTS_PAGE
	);

	console.log('fetching current quest skill requirements');

	const html = await getRequestHTML(pageURI);
	const $ = cheerio.load(html);

	const skills = new Map();

	$('tr[data-rowid]').each((index, row) => {
		const questName = $(row).attr('data-rowid');

		if (!questName) {
			return;
		}

		$(row).find('[data-skill][data-level]').each((i, element) => {
			const skill = $(element).attr('data-skill');
			const level = parseInt($(element).attr('data-level'), 10);

			if (!skill || Number.isNaN(level)) {
				return;
			}

			if (!skills.has(skill)) {
				skills.set(skill, []);
			}

			const questRequirements = skills.get(skill);

			const existing = questRequirements.find(
				req => req.quest === questName
			);

			// The third cell in the individual skill table is the Boostable column.
			const cells = $(row).children('td');
			const boostableText = cells.eq(2).text().trim().toLowerCase();

			const boostable =
				boostableText === 'yes' ||
				boostableText.includes('yes');

			if (!existing) {
				questRequirements.push({
					quest: questName,
					level: level,
					boostable: boostable
				});
			} else {
				if (level > existing.level) {
					existing.level = level;
				}

				if (boostable) {
					existing.boostable = true;
				}
			}
		});
	});

	const result = [];

	skills.forEach((quests, skill) => {
		result.push({
			skill: skill,
			quests: quests
		});
	});

	const totalRequirements = result.reduce(
		(total, skill) => total + skill.quests.length,
		0
	);

	console.log(
		`parsed ${totalRequirements} skill requirements across ${result.length} skills`
	);

	return result;
}

// do get request to uri and return html
async function getRequestHTML(uri) {
	let res = await axios.get(uri, {
		headers: {
			'User-Agent': 'osrs-wiki-parse/1.0'
		}
	});

	if (res.status !== 200) {
		throw new Error(`Request failed with status ${res.status}`);
	}

	if (!res.data.parse || !res.data.parse.text) {
		console.error('\nWiki API error for:');
		console.error(uri);
		console.error('\nResponse:');
		console.error(JSON.stringify(res.data, null, 2));
		throw new Error('Wiki API did not return parsed HTML');
	}

	return res.data.parse.text['*'];
}
