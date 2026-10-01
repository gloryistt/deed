// Story content for the murder mystery: settings, characters, traits (and the clues they leave), weapons.

const SETTINGS = [
  {
    name: 'Blackwood Manor',
    emoji: '🏚️',
    intro: 'Rain hammers the windows of Blackwood Manor. The bridge to the village washed out an hour ago, and the phone line went dead with it. Nobody is leaving tonight.',
    host: 'Lord Edmund Blackwood',
    hostFound: 'slumped over his desk in the study, a cold cup of tea beside him',
    rooms: ['library', 'conservatory', 'wine cellar', 'ballroom', 'kitchen', 'study', 'grand staircase', 'billiard room'],
    night: ['Thunder rolls over the manor.', 'A grandfather clock strikes midnight somewhere in the dark.', 'The candles gutter as a draft sweeps the halls.'],
    morning: ['Grey light crawls across the lawns.', 'The storm has eased, but the bridge is still gone.', 'The butler rings the breakfast bell. Not everyone answers.'],
  },
  {
    name: 'The Midnight Express',
    emoji: '🚂',
    intro: 'The Midnight Express thunders through the Alps. An avalanche has blocked the pass ahead, and the train sits trapped in the snow until the plows arrive.',
    host: 'Baron Viktor Kessel',
    hostFound: 'in his locked sleeper compartment, the window frosted over from the inside',
    rooms: ['dining car', 'sleeper car', 'luggage van', 'observation deck', 'bar car', 'engine room'],
    night: ['The carriage lights flicker and die.', 'Wind screams through the gaps in the doors.', 'Somewhere a compartment door slides shut.'],
    morning: ['Pale sun glints off the snowdrifts.', 'The conductor walks the corridor, counting heads.', 'Breakfast is served in the dining car. Several seats stay empty.'],
  },
  {
    name: 'SS Aurora',
    emoji: '🛳️',
    intro: 'The SS Aurora drifts through a thick midnight fog, three days from any port. The radio room has been smashed. Whoever did it is still aboard.',
    host: 'Captain Josephine Hart',
    hostFound: 'at the foot of the bridge stairs, her captain’s hat a few feet away',
    rooms: ['casino', 'engine room', 'pool deck', 'ballroom', 'cargo hold', 'captain’s bridge'],
    night: ['The foghorn moans across the black water.', 'The ship creaks and lists in the swell.', 'A splash, far below. Then nothing.'],
    morning: ['The fog thins into a pale, cold dawn.', 'Gulls cry over the empty deck.', 'The steward knocks on every cabin door.'],
  },
  {
    name: 'Hollow Pines Lodge',
    emoji: '🏔️',
    intro: 'A blizzard has buried Hollow Pines Lodge. The road is gone, the power is out, and the only light comes from the great stone fireplace.',
    host: 'Old Man Grady, the lodge owner',
    hostFound: 'face-down in the snow outside the ski shed, a trail of footprints half filled in',
    rooms: ['sauna', 'lounge', 'ski shed', 'attic', 'kitchen', 'hot tub deck'],
    night: ['The fire burns low and the cold creeps in.', 'Wolves howl somewhere up the mountain.', 'A floorboard creaks upstairs. Everyone is supposed to be asleep.'],
    morning: ['Snow glitters under a hard blue sky.', 'Someone stokes the fire back to life.', 'The coffee pot is on, but the mood is not.'],
  },
  {
    name: 'Ravenshade Carnival',
    emoji: '🎪',
    intro: 'The carnival closed at midnight, but the gates won’t open again. The calliope keeps playing by itself, and the fog off the marsh is too thick to see the road.',
    host: 'Barnaby Crowe, the ringmaster',
    hostFound: 'slumped in the hall of mirrors, a hundred reflections staring back',
    rooms: ['hall of mirrors', 'big top', 'fun house', 'ferris wheel', 'fortune teller’s tent', 'carousel', 'freak show wagon'],
    night: ['The carousel starts turning on its own.', 'A clown laughs somewhere in the dark. Nobody here is a clown.', 'The ferris wheel creaks to a stop, one car swinging.'],
    morning: ['Grey dawn light leaks through the tent canvas.', 'The calliope finally falls silent.', 'Popcorn crunches underfoot as everyone gathers by the gate.'],
  },
  {
    name: 'Orbital Station Kepler-9',
    emoji: '🛰️',
    intro: 'Kepler-9 orbits a dead moon, six months from Earth. The relay array went dark during the solar storm. The next supply ship is weeks away.',
    host: 'Commander Ilsa Varga',
    hostFound: 'floating in the hydroponics bay, her helmet visor cracked',
    rooms: ['hydroponics bay', 'airlock', 'reactor core', 'med bay', 'observation dome', 'crew quarters', 'cargo module'],
    night: ['The station dims to night-cycle red.', 'An airlock cycles. Nobody logged the request.', 'The reactor hums a half-step lower than usual.'],
    morning: ['Day-cycle lights flicker on, one panel at a time.', 'The station AI chimes: crew count does not match the manifest.', 'Earth rises in the observation dome window.'],
  },
  {
    name: 'The Golden Palms Casino',
    emoji: '🎰',
    intro: 'A private high-stakes night at the Golden Palms. The doors were sealed at midnight so nobody could slip out with the house’s money. Now nobody can slip out at all.',
    host: 'Vincent “Lucky” Moreau, the owner',
    hostFound: 'face-down on the roulette table, the ball still spinning',
    rooms: ['high-roller lounge', 'vault', 'roulette floor', 'security office', 'penthouse suite', 'kitchen', 'cocktail bar'],
    night: ['The slot machines blink and chime in an empty room.', 'The vault’s time lock clicks once.', 'A pair of dice clatters down the stairs.'],
    morning: ['The windowless floor never changes, but the clocks say morning.', 'A dealer counts heads at the bar.', 'Fresh coffee, cold chips, and one empty chair.'],
  },
];

const CHARACTERS = [
  ['Lady Scarlet Vane', 'the heiress'], ['Colonel Ashford', 'the war hero'], ['Dr. Iris Mercer', 'the family physician'],
  ['Professor Hale', 'the eccentric scholar'], ['Madame Rouge', 'the opera singer'], ['Father Bram', 'the quiet priest'],
  ['Juniper Wren', 'the young journalist'], ['Sterling Cross', 'the banker'], ['Chef Aurelio', 'the temperamental chef'],
  ['Countess Noir', 'the widow'], ['Captain Reyes', 'the retired sailor'], ['Opal Finch', 'the gardener'],
  ['Judge Harrow', 'the retired judge'], ['Violet Ames', 'the jazz pianist'], ['Mr. Pemberton', 'the butler'],
  ['Dr. Silas Crane', 'the chemist'], ['Rosalind Grey', 'the novelist'], ['Inspector Lowe', 'the off-duty policeman'],
  ['Duchess Aveline', 'the aristocrat'], ['Felix Marlowe', 'the magician'], ['Nurse Hollis', 'the private nurse'],
  ['Baron Kovac', 'the art collector'], ['Ivy Holloway', 'the maid'], ['Senator Blaine', 'the politician'],
  ['Mack Dorsey', 'the chauffeur'],
];

// Every trait is held by exactly one character, so a clue points at one person (or is a red herring).
const TRAITS = {
  garment: [
    ['wears a crimson scarf', 'a thread of crimson silk snagged on the door hinge'],
    ['wears a velvet green coat', 'a scrap of green velvet caught on a splinter'],
    ['wears white silk gloves', 'a faint glove print on the polished banister'],
    ['wears a navy peacoat', 'a brass anchor button lying under the body'],
    ['wears a gold brooch', 'a tiny gold pin bent out of shape near the doorway'],
    ['wears a black top hat', 'a black felt hat band crushed under the table'],
    ['wears pearl earrings', 'a single pearl rolled into the corner'],
    ['wears a tweed waistcoat', 'a tuft of brown tweed clutched in the victim’s hand'],
    ['wears a violet shawl', 'violet fibers on the victim’s sleeve'],
    ['carries a leather satchel', 'the scuff of a leather strap along the wallpaper'],
    ['wears a silver pocket watch', 'a broken watch chain link on the rug'],
    ['wears red lipstick', 'a smudge of red lipstick on a wine glass'],
    ['wears a monocle', 'a monocle chain dangling from a coat hook'],
    ['wears a feathered hat', 'a white feather drifting under the curtain'],
    ['wears a bow tie', 'a crushed silk bow tie behind the sofa'],
    ['wears a fur stole', 'a tuft of silver fur on the armchair'],
    ['wears cufflinks', 'a lone sapphire cufflink by the fireplace'],
    ['wears an emerald necklace', 'a tiny emerald chip glinting in the rug'],
    ['wears a beret', 'a dark wool beret tossed in the hallway'],
    ['wears a trench coat', 'a wet trench-coat belt draped over the railing'],
    ['wears a lace veil', 'a torn scrap of black lace on the door frame'],
    ['wears a bowler hat', 'a round dent in the dust, the shape of a bowler hat'],
    ['wears a white apron', 'a flour-dusted handprint on the doorframe'],
    ['wears driving gloves', 'a leather glove print on the car keys'],
    ['wears a signet ring', 'a wax seal pressed with a family crest'],
  ],
  scent: [
    ['smells of cigar smoke', 'the room still smells of cigar smoke'],
    ['smells of lavender perfume', 'a faint sweetness of lavender hangs in the air'],
    ['smells of peppermint', 'a peppermint wrapper crumpled on the floor'],
    ['smells of gunpowder', 'a sharp tang of gunpowder lingers'],
    ['smells of old books', 'a dusty, papery smell, like an old library'],
    ['smells of sea salt', 'salt crystals dried on the floorboards'],
    ['smells of rosewater', 'a trace of rosewater on the door handle'],
    ['smells of cinnamon', 'a warm hint of cinnamon, oddly out of place'],
    ['smells of motor oil', 'a greasy black thumbprint on the light switch'],
    ['smells of pine sap', 'sticky pine sap on the windowsill'],
    ['smells of whiskey', 'a spilled glass of whiskey, still wet'],
    ['smells of garden soil', 'dark soil crumbs across the carpet'],
    ['smells of cologne', 'a heavy musky cologne clinging to the curtains'],
    ['smells of chloroform', 'a sickly sweet chemical smell near the body'],
    ['smells of coffee', 'coffee grounds scattered on the floor'],
    ['smells of smoke and ash', 'fresh ash smeared on the carpet'],
    ['smells of oranges', 'orange peel curls in the ashtray'],
    ['smells of mothballs', 'the sharp tang of mothballs in the hallway'],
    ['smells of turpentine', 'a paint-thinner smell drifting from the corner'],
    ['smells of vanilla', 'a sweet vanilla scent on the pillow'],
    ['smells of wet dog', 'muddy paw prints and a damp animal smell'],
    ['smells of candle wax', 'drips of candle wax trailing to the door'],
    ['smells of antiseptic', 'a clinical antiseptic smell on the doorknob'],
    ['smells of gasoline', 'a gasoline-soaked rag in the bin'],
    ['smells of licorice', 'a black licorice twist on the windowsill'],
  ],
  mark: [
    ['is left-handed', 'the wound suggests a left-handed attacker'],
    ['has muddy boots', 'muddy boot prints leading away'],
    ['has ink-stained fingers', 'an inky fingerprint on the victim’s collar'],
    ['walks with a limp', 'uneven footprints, one foot dragging'],
    ['has a bandaged hand', 'a bloody strip of bandage in the fireplace'],
    ['wears heavy rings', 'a deep ring-shaped bruise on the victim’s cheek'],
    ['has long painted nails', 'a broken painted fingernail on the floor'],
    ['is very tall', 'a scuff mark far too high on the wall for most people'],
    ['chews their nails', 'a bitten-off fingernail by the body'],
    ['wears spectacles', 'a cracked spectacle lens under a chair'],
    ['has calloused hands', 'rough scratches on the victim’s wrist'],
    ['has a nervous cough', 'a witness heard coughing in the hallway around midnight'],
    ['has a gold tooth', 'a witness saw a flash of gold in the dark'],
    ['has a tattooed wrist', 'an ink-blue smudge like a tattoo transfer on the wall'],
    ['has scratches on their face', 'skin under the victim’s fingernails'],
    ['whistles constantly', 'someone was heard whistling near the scene'],
    ['hums opera', 'a guest heard humming from inside the room'],
    ['has a scarred hand', 'a jagged handprint in the dust'],
    ['wears heavy boots', 'deep heel marks gouged into the floorboards'],
    ['has freckles', 'a witness glimpsed a freckled face in the doorway'],
    ['carries a cane', 'a round cane tip impression beside the footprints'],
    ['is short', 'the struggle marks are low on the wall'],
    ['has shaky hands', 'spilled drink and splashes everywhere'],
    ['bites their lip', 'a speck of blood on a handkerchief'],
    ['is very strong', 'the heavy door was forced off its hinges'],
  ],
};

const WEAPONS = [
  ['candlestick', 'struck down with a heavy brass candlestick'],
  ['poisoned wine', 'poisoned, a half-finished glass of wine at their side'],
  ['silk rope', 'strangled with a length of silk rope'],
  ['letter opener', 'stabbed with a silver letter opener'],
  ['revolver', 'shot once, the sound hidden by the storm'],
  ['lead pipe', 'bludgeoned with a length of lead pipe'],
  ['ice pick', 'stabbed with an ice pick taken from the bar'],
  ['antique dagger', 'run through with an antique dagger from the wall display'],
  ['fireplace poker', 'struck with an iron fireplace poker'],
  ['arsenic tea', 'poisoned with arsenic, a teacup overturned on the floor'],
];

// team: who they win with. night: their night action ('kill' | 'frame' | 'inspect' | 'protect' | 'guard' | 'watch' | 'shoot' | null).
const ROLES = {
  murderer: {
    name: 'Murderer', emoji: '🔪', team: 'murderers', night: 'kill',
    goal: 'Kill the guests one by one without getting caught. Your side wins when it equals or outnumbers everyone else.',
    how: 'Each night I DM you the guest list. Reply `kill <#>` (add `with <weapon>` to choose it, e.g. `kill 2 with poker`). Once per game you can also `frame <#>` (tonight’s clues point at them and the detective sees them as suspicious) and `clean` (tonight’s kill leaves no clues and burns the victim’s will). If you `mm search` a room by day, you quietly destroy whatever was there.',
  },
  accomplice: {
    name: 'Accomplice', emoji: '🤝', team: 'murderers', night: 'frame',
    goal: 'Help the murderers win. You look innocent to the detective. If every murderer is caught, you become the new murderer.',
    how: 'Each night reply `frame <#>` to make the detective see that person as suspicious, or `skip`. Careful: the Witness can see you sneak out. Your `mm search` destroys evidence too.',
  },
  detective: {
    name: 'Detective', emoji: '🔍', team: 'town', night: 'inspect',
    goal: 'Each night, investigate one person. Framed people look suspicious, and the accomplice looks innocent, so be careful.',
    how: 'Each night reply `inspect <#>`.',
  },
  doctor: {
    name: 'Doctor', emoji: '💉', team: 'town', night: 'protect',
    goal: 'Each night, protect one person (yourself included) from being killed. Not the same person two nights in a row.',
    how: 'Each night reply `protect <#>`.',
  },
  bodyguard: {
    name: 'Bodyguard', emoji: '🛡️', team: 'town', night: 'guard',
    goal: 'Each night, guard one person. If the killer comes for them, you die in their place and leave behind a clue that is guaranteed true.',
    how: 'Each night reply `guard <#>`.',
  },
  witness: {
    name: 'Witness', emoji: '👁️', team: 'town', night: 'watch',
    goal: 'Each night, watch one guest’s door. At dawn you learn whether they left their room, and whose room they went to. Frames can’t fool you, but every night role moves around, not just killers.',
    how: 'Each night reply `watch <#>`.',
  },
  mayor: {
    name: 'Mayor', emoji: '🎩', team: 'town', night: null,
    goal: 'Your guilty/innocent vote at trials counts double. Nobody knows unless you tell them.',
    how: 'No night action. During the day you can `mm reveal` yourself: your vote then counts triple, but everyone (the killer included) knows who you are.',
  },
  vigilante: {
    name: 'Vigilante', emoji: '🔫', team: 'town', night: 'shoot',
    goal: 'You have one bullet. Use it at night on someone you’re sure is a killer. If you shoot an innocent guest, you die of guilt.',
    how: 'One night, reply `shoot <#>`. Other nights, `skip`.',
  },
  medium: {
    name: 'Medium', emoji: '🔮', team: 'town', night: null,
    goal: 'You can talk to the dead. At night, anything you DM me reaches the ghosts, and they can answer you.',
    how: 'At night, just DM me. The dead hear you (they don’t know who you are), and their replies come back to you.',
  },
  survivor: {
    name: 'Survivor', emoji: '🏕️', team: 'survivor', night: null,
    goal: 'You don’t care who wins. You win if you’re still alive at the end.',
    how: 'You have 2 bulletproof vests. At night, DM me `vest` to survive one attack that night.',
  },
  executioner: {
    name: 'Executioner', emoji: '⚖️', team: 'executioner', night: null,
    goal: 'You have a target. Get them convicted at a trial and you win (and stay in the game). If they die any other way, you become a Jester.',
    how: 'No night action. Talk the group into voting your target guilty.',
  },
  jester: {
    name: 'Jester', emoji: '🃏', team: 'jester', night: null,
    goal: 'You win if the group votes you guilty at a trial. Act suspicious, but not too suspicious.',
    how: 'No night action. Get yourself convicted.',
  },
  guest: {
    name: 'Guest', emoji: '🙂', team: 'town', night: null,
    goal: 'Cross-check the clues, search the rooms, question everyone, and convict the murderers before it’s too late.',
    how: 'No night action. During the day, `mm search <room>` once for extra clues.',
  },
};

// How each clue category is introduced (the options are the traits).
const CLUE_INTROS = {
  garment: ['A witness glimpsed the killer’s outfit. They were wearing one of:', 'Fibers on the body match one of:'],
  scent: ['The room reeked of one of:', 'The victim’s coat smells faintly of one of:'],
  mark: ['Marks at the scene suggest the killer:', 'The way the body fell suggests someone who:'],
};

// Random night events (chance per night).
// min: only roll this event with at least this many guests alive (some are game-deciding in tiny games).
const EVENTS = [
  { id: 'outage', chance: 0.12, text: '⚡ **Power outage!** The lights died all night. Whatever happened left no clues.' },
  { id: 'diary', chance: 0.08, min: 6, text: '📖 **A torn diary page** turns up under a door, in the host’s own hand…' },
  { id: 'seance', chance: 0.1, text: '🕯️ **A séance.** Someone lit candles for the dead, and a voice answered…' },
  { id: 'dog', chance: 0.1, text: '🐕 **The dog barked at midnight** outside one room.' },
];
const DEFAULT_WEAPON = 'candlestick';

// Interrogation questions ({room} and {host} are filled in).
const QUESTIONS = [
  'Where were you when the lights went out?',
  'Why were you seen near the {room} last night?',
  'What was your relationship with {host}, really?',
  'Who do you think did it, and why?',
  'What’s in your pockets right now?',
  'Can anyone confirm where you were at midnight?',
  'Why did you go quiet when the body was found?',
  'You were the last one to see {host} alive. What did they say?',
  'Someone saw you washing your hands at 3am. Explain.',
  'If you had to accuse one person right now, who?',
  'What were you doing in the {room}?',
  'Why should anyone here trust you?',
];

module.exports = { SETTINGS, CHARACTERS, TRAITS, WEAPONS, ROLES, CLUE_INTROS, EVENTS, DEFAULT_WEAPON, QUESTIONS };
