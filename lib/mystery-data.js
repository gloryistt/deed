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

// team: who they win with. night: their night action ('kill' | 'frame' | 'inspect' | 'protect' | 'guard' | null).
const ROLES = {
  murderer: {
    name: 'Murderer', emoji: '🔪', team: 'murderers', night: 'kill',
    goal: 'Kill the guests one by one without getting caught. Your side wins when it equals or outnumbers everyone else.',
    how: 'Each night I DM you the guest list. Reply `kill <#>` (add `with <weapon>` to choose it, e.g. `kill 2 with poker`). Once per game you can also `frame <#>` (tonight’s clues point at them and the detective sees them as suspicious) and `clean` (tonight’s kill leaves no clues).',
  },
  accomplice: {
    name: 'Accomplice', emoji: '🤝', team: 'murderers', night: 'frame',
    goal: 'Help the murderers win. You look innocent to the detective. If every murderer is caught, you become the new murderer.',
    how: 'Each night reply `frame <#>` to make the detective see that person as suspicious, or `skip`.',
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
  mayor: {
    name: 'Mayor', emoji: '🎩', team: 'town', night: null,
    goal: 'Your guilty/innocent vote at trials counts double. Nobody knows unless you tell them.',
    how: 'No night action. Use your double vote wisely.',
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
const EVENTS = [
  { id: 'outage', chance: 0.12, text: '⚡ **Power outage!** The lights died all night. Whatever happened left no clues.' },
  { id: 'seance', chance: 0.1, text: '🕯️ **A séance.** Someone lit candles for the dead, and a voice answered…' },
  { id: 'dog', chance: 0.1, text: '🐕 **The dog barked at midnight** outside one room.' },
];
const DEFAULT_WEAPON = 'candlestick';

module.exports = { SETTINGS, CHARACTERS, TRAITS, WEAPONS, ROLES, CLUE_INTROS, EVENTS, DEFAULT_WEAPON };
