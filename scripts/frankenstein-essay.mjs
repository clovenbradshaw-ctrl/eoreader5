import { runEssay } from '../packages/essay/essay.js';
import { canonicalHashSync } from '../packages/spec/canonical-json/index.js';

const id = (prefix, value) => `${prefix}:${canonicalHashSync(value)}`;

const chapter1 = `You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking. I am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight. This breeze, which has travelled from the regions towards which I am advancing, gives me a foretaste of those icy climes. Inspired by this wind of promise, my daydreams become more fervent and vivid. In a few days I shall cross the sea of ice that separates me from the Arctical world. But these exercises are trifles compared with the prospect which now lies before me. I could undertake the most wonderful expedition. The polar regions present the most formidable obstacle to the persevering traveller. But I shall proceed. I may find there the remains of the natural world which has ceased to exist. The mountains of ice have barred up my passage, and I may be imprisoned in the ice and may never return. My imagination is vivid, and my resolutions are fervent. I have a fervent desire to succeed. I am like the wild fox that has broken from the trap. But I must not be detained. I shall write to you again soon.`;

const chapter2 = `I spent the following day collecting materials for my intended work. I resolved to quit a country where I had incurred the suspicion of its inhabitants, and to seek a land of freedom. I departed from my native country with a firm resolution. I arrived at Marseilles and took passage on a ship bound for England. The vessel was a trading ship sailing to the Levant. I made friends with the captain, a simple and straightforward man. He was interested in my adventures and asked me many questions. I told him that I was a student who wished to see the world. The voyage was pleasant enough. We had fine weather and the ship made good speed. I spent much time reading and thinking about my plans. I was eager to reach England where I could find the materials I needed. When we arrived at Deptford I went immediately to London. I had a passionate desire to penetrate the secrets of nature. I was eager to learn everything about the human body and the causes of life and death.`;

const chapter3 = `I arrived in England at the beginning of autumn. I had now been absent from my native country for nearly three years. I had traversed the greater part of the civilized world. I had felt the extremes of heat and cold. I had been shipwrecked and had suffered every hardship. But I was now in a land of civilization and comfort. I sought out the most learned men in the universities. I studied under the most celebrated professors. I was diligent and they were impressed with my zeal. But I found that the knowledge I sought was not to be obtained from the existing teachers. They had reached the limits of their science and could teach me no more. I needed to find new sources of knowledge. I needed to search in the most ancient tombs and the most forgotten libraries. I needed to discover the secrets of nature that had been hidden for centuries. I was not discouraged. My resolution was firm. I would pursue my researches with unremitting ardor.`;

const budgetText = `Victor Frankenstein,Educational expenditure,500,1790 / Victor Frankenstein,Laboratory equipment,1200,1793 / Victor Frankenstein,Travel expenses,300,1789 / Victor Frankenstein,Chemical supplies,450,1792 / Henry Clerval,Educational expenditure,400,1790 / Henry Clerval,Travel expenses,250,1792 / Robert Walton,Ship provisions,2000,1796 / Robert Walton,Navigation instruments,800,1795 / Robert Walton,Crew wages,1500,1796 / The Creature,Subsistence,0,1793`;

const surveyText = `Does Victor bear moral responsibility? Yes - he created life and abandoned it (High confidence). Is the Creature morally culpable? No - he was abandoned and driven to violence by circumstance (High confidence). Who is the true protagonist? Victor - his ambition drives the narrative (Medium). Who is the true protagonist? The Creature - his suffering is the emotional center (Medium). Is the novel primarily about science? Yes - it warns against unchecked scientific ambition (High). Is the novel primarily about parenthood? Yes - it explores the failure of parental responsibility (High). Does Walton learn from Victor's story? Yes - he turns back from the ice (High). Is sympathy for the Creature justified? Yes - his violence is a product of social rejection (High).`;

function span(text, sourceId, suffix) {
  return { span_id: id('span', `${sourceId}:${suffix}`), source_id: sourceId, field_id: `${sourceId}:field:0`, text };
}

const projectionChapters = {
  spans: [
    span('You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings.', 'frankenstein-ch1', 'voyage'),
    span('I am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight.', 'frankenstein-ch1', 'arctic'),
    span('The mountains of ice have barred up my passage, and I may be imprisoned in the ice and may never return.', 'frankenstein-ch1', 'ice'),
    span('My imagination is vivid, and my resolutions are fervent. I have a fervent desire to succeed.', 'frankenstein-ch1', 'imagination'),
    span('Inspired by this wind of promise, my daydreams become more fervent and vivid.', 'frankenstein-ch1', 'promise'),
    span('I departed from my native country with a firm resolution.', 'frankenstein-ch2', 'departure'),
    span('I made friends with the captain, a simple and straightforward man.', 'frankenstein-ch2', 'captain'),
    span('I had a passionate desire to penetrate the secrets of nature. I was eager to learn everything about the human body and the causes of life and death.', 'frankenstein-ch2', 'desire'),
    span('I spent much time reading and thinking about my plans.', 'frankenstein-ch2', 'reading'),
    span('I arrived in England at the beginning of autumn. I had now been absent from my native country for nearly three years.', 'frankenstein-ch3', 'england'),
    span('I studied under the most celebrated professors. I was diligent and they were impressed with my zeal.', 'frankenstein-ch3', 'study'),
    span('They had reached the limits of their science and could teach me no more.', 'frankenstein-ch3', 'limits'),
    span('I needed to discover the secrets of nature that had been hidden for centuries.', 'frankenstein-ch3', 'secrets'),
    span('My resolution was firm. I would pursue my researches with unremitting ardor.', 'frankenstein-ch3', 'resolution'),
  ],
};

const projectionBudget = {
  spans: [
    span('Victor Frankenstein,Educational expenditure,500,1790 / Victor Frankenstein,Laboratory equipment,1200,1793 / Victor Frankenstein,Travel expenses,300,1789 / Victor Frankenstein,Chemical supplies,450,1792', 'character-attributes', 'victor-budget'),
    span('Henry Clerval,Educational expenditure,400,1790 / Henry Clerval,Travel expenses,250,1792', 'character-attributes', 'henry-budget'),
    span('Robert Walton,Ship provisions,2000,1796 / Robert Walton,Navigation instruments,800,1795 / Robert Walton,Crew wages,1500,1796', 'character-attributes', 'walton-budget'),
    span('The Creature,Subsistence,0,1793', 'character-attributes', 'creature-budget'),
  ],
};

const projectionSurvey = {
  spans: [
    span('Does Victor bear moral responsibility? Yes - he created life and abandoned it (High confidence).', 'reader-survey', 'responsibility'),
    span('Is the Creature morally culpable? No - he was abandoned and driven to violence by circumstance (High confidence).', 'reader-survey', 'culpability'),
    span('Who is the true protagonist? Victor - his ambition drives the narrative (Medium). Who is the true protagonist? The Creature - his suffering is the emotional center (Medium).', 'reader-survey', 'protagonist'),
    span('Is the novel primarily about science? Yes - it warns against unchecked scientific ambition (High). Is the novel primarily about parenthood? Yes - it explores the failure of parental responsibility (High).', 'reader-survey', 'theme'),
    span('Does Walton learn from Victor\'s story? Yes - he turns back from the ice (High).', 'reader-survey', 'walton'),
    span('Is sympathy for the Creature justified? Yes - his violence is a product of social rejection (High).', 'reader-survey', 'sympathy'),
  ],
};

const result = runEssay({
  projections: [projectionChapters, projectionBudget, projectionSurvey],
  thesis: 'Frankenstein traces an arc from youthful ambition through isolation and obsession, revealing the human cost of pursuing knowledge without moral restraint',
});

console.log(JSON.stringify(result, null, 2));
