const axios = require('axios');
const fs = require('fs');
const xray = require('x-ray')({
	filters: {
		quest_req: (value) => {
			let req = value.split('-');
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

// Define the Quests/Skill_requirements identifier.
const SKILL_REQUIREMENTS_PAGE = 'Quests/Skill_requirements';

// The idx consts define the section where the skills start and end. (agility ... woodcutting)
const SKILL_REQ_START_IDX = 1;
const SKILL_REQ_END_IDX = 25;

// Entrypoint
(async () => {
	let quests = await parseGuide();
	let requirements = await parseRequirements();

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
		let whitelist = ['The Grand Tree'];

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
			name: quest,
			uri: `https://oldschool.runescape.wiki/w/${quest.replaceAll(' ', '_')}`,
			reqs: [],
		};
	});

	// remove undefined(s)
	return quests.filter((quest) => quest);
}

// parse: Quests/Skill_requirements
async function parseRequirements() {
	const skillPageURI = API_BASE_URI.replace(
		PAGE_NAME_PLACEHOLDER,
		SKILL_REQUIREMENTS_PAGE
	);

	// array for all the requirements
	let allRequirements = [];

	// Loop through all requirements
	for (let i = SKILL_REQ_START_IDX; i <= SKILL_REQ_END_IDX; i++) {
		console.log(
			'parsing quest requirement: %d of %d',
			i,
			SKILL_REQ_END_IDX
		);

		// Setup uri for the current section.
		let sectionURI = skillPageURI.concat(
			API_QUERY_SECTION.replace(SECTION_NUMBER_PLACEHOLDER, i)
		);

		// GET
		let html = await getRequestHTML(sectionURI);

		// Extract skill + quest reqs.
		let skillRequirements = await xray(html, 'div', {
			skill: xray('div:nth-child(1)', 'a@title'),
			quests: xray('div:nth-child(2)', ['li | quest_req']),
		});

		allRequirements.push(skillRequirements);
	}

	return allRequirements;
}

// do get request to uri and return html
async function getRequestHTML(uri) {
	let res = await axios.get(uri);
	if (res.status !== 200) {
		throw new Error('request failed with error', res.status);
	}

	return res.data['parse']['text']['*'];
}
