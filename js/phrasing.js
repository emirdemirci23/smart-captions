/*
 * Smart Captions – phrasing rules
 * --------------------------------
 * A small part-of-speech tagger (English and Turkish) and the "cohesion"
 * between neighbouring words, following common subtitle line-break rules
 * (Netflix / BBC style): don't separate
 *   - an adjective from its noun          "a beautiful | house"
 *   - an article / possessive from its word "the | house", "my | car"
 *   - a preposition from its object        "in | the middle"
 *   - a helper verb from its verb          "will | go", "have | been"
 *   - "to" from its verb, a negation from what it negates
 * and prefer breaks before conjunctions, before prepositional phrases and
 * after punctuation.
 *
 * Pure JavaScript, no dependencies; works in the panel and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SmartPhrasing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function set(str) {
    var s = Object.create(null);
    str.split(/\s+/).forEach(function (w) { if (w) s[w] = true; });
    return s;
  }

  function clean(text) {
    return String(text).toLowerCase().replace(/[’`]/g, "'").replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
  }

  function trailingPunct(text) { return /[^\p{L}\p{N}]$/u.test(text) && !/['’]$/.test(text); }

  // ---------------------------------------------------------------- English

  var EN = {
    DET: set('a an the this these those every each some any another either neither all both half several such ' +
      'whatever whichever'),
    QUANT: set('many much few little more most less least enough lots plenty'),
    POSS: set('my your his her its our their whose'),
    PRON: set('i you he she it we they me him us them myself yourself himself herself itself ourselves yourselves ' +
      'themselves someone somebody something anyone anybody anything everyone everybody everything nobody nothing ' +
      'mine yours hers ours theirs'),
    SUBJ: set('i you he she it we they there'),
    PREP: set('up about above across against along among amongst around at behind below beneath beside besides between ' +
      'beyond by despite down during except for from in inside into like near of off on onto out outside over past ' +
      'through throughout toward towards under underneath upon via with within without per than versus via'),
    // words that are a preposition or a conjunction depending on context
    PREP_CONJ: set('after before since until till as'),
    CONJ: set('and or but nor yet because although though while whereas unless whether if once whenever wherever ' +
      'so'),
    REL: set('who whom which where when why how that what'),
    AUX: set('am is are was were be been being have has had having do does did will would shall should can could ' +
      'may might must ought gonna wanna gotta'),
    COP: set('am is are was were be been being'),
    NEG: set('not never no'),
    NEG_CONTR: /n't$|^cannot$/,
    PRON_AUX: /^(i|you|he|she|it|we|they|that|there|what|who|here|where|how|let)'(m|re|s|ve|ll|d)$/,
    PARTICLE: set('up out down off away back over on in around about through along apart aside forward together'),
    INTJ: set('oh ah yeah yes yep nope okay ok hi hello hey wow um uh hmm well alright please thanks'),
    ADV: set('very really so too quite rather just also only even still already always never often sometimes ' +
      'usually here there now then today tonight tomorrow yesterday soon again almost actually maybe perhaps ' +
      'probably definitely absolutely totally completely extremely incredibly highly fairly ever yet together ' +
      'away back instead anyway however therefore otherwise later earlier once twice nearly hardly barely ' +
      'pretty super literally basically honestly seriously simply exactly especially'),
    INTENS: set('very really so too quite rather pretty super extremely incredibly highly fairly totally completely ' +
      'absolutely most more less least truly deeply'),
    ADJ: set('good bad new old big small large little great high low long short young early late important ' +
      'different same right wrong real true false easy hard difficult simple clear sure able free full whole open ' +
      'close closed best better worse worst last next first second third main major minor public private social ' +
      'special general human local national beautiful nice happy sad quick slow fast strong weak hot cold warm cool ' +
      'dark light heavy rich poor huge tiny amazing awesome wonderful terrible horrible perfect possible impossible ' +
      'available ready certain recent current final common natural serious single entire similar various personal ' +
      'quiet loud funny strange weird interesting boring exciting popular famous favorite favourite red blue green ' +
      'yellow black white brown gray grey orange purple pink golden wooden empty busy safe dangerous healthy fresh ' +
      'clean dirty smart stupid crazy lucky cheap expensive deep wide narrow thin thick soft sharp smooth flat round ' +
      'square lovely gorgeous ugly fine extra basic modern classic traditional typical original unique creative ' +
      'professional technical digital visual whole own key top bottom left middle inner outer upper lower total ' +
      'proper fair tough rough bright brilliant calm angry afraid alive alone aware glad sorry tired nervous proud ' +
      'excellent fantastic incredible ideal obvious ordinary rare regular secret silent simple solid stable ' +
      'strict sudden sweet tall tight tough tricky useful useless valuable vast wild wise worried young massive ' +
      'gentle honest humble kind polite rude brave clever cute fancy friendly helpful hungry lazy mad quick ready ' +
      'lush cozy cosy elaborate accurate readable decent sturdy sleek minimalist remote dusty leather handwritten ' +
      'sleepy windy delicious homemade adorable annual crisp tasty juicy crunchy spicy salty sour bitter fluffy ' +
      'shiny glossy rusty muddy foggy rainy sunny snowy stormy chilly freezing boiling icy humid dry wet ' +
      'ancient brand-new vintage fragile sturdy loyal generous greedy curious anxious eager keen jealous ' +
      'gorgeous stunning hilarious awkward bizarre peaceful chaotic noisy crowded empty narrow steep shallow ' +
      'rapid sharp subtle vivid bold dull faint harsh mild rich raw ripe rotten stale tender tight loose ' +
      'senior junior elderly teenage adult urban rural tropical arctic coastal domestic foreign global ' +
      'legal illegal medical financial political military industrial cultural environmental emotional'),
    // common verbs (base forms); -s/-ed/-ing forms are recognised from these
    VERB: set('be have do say get make go know take see come think look want give use find tell ask work seem feel ' +
      'try leave call keep let begin show hear play run move like live believe hold bring happen write provide sit ' +
      'stand lose pay meet include continue set learn change lead understand watch follow stop create speak read ' +
      'spend grow open walk win offer remember love consider appear buy wait serve die send expect build stay fall ' +
      'cut reach kill remain suggest raise pass sell require report decide pull split put need help start talk turn ' +
      'mean become hate eat drink sleep sing check record edit film shoot add apply explain share subscribe click ' +
      'enjoy finish fix hope imagine join jump laugh listen miss notice pick plan prefer prepare press push relax ' +
      'save sound speak stick teach thank touch travel worry agree allow avoid break catch choose climb cook count ' +
      'cover cross cry dance describe design discover draw dream drive drop fill fly forget guess hang hide hit ' +
      'hurt introduce invite keep kick knock land lie lift light mark mention mix order paint pay produce promise ' +
      'protect prove reach realise realize receive recommend reduce refuse repeat replace rest return ride ring rise ' +
      'roll rush search shake shut sign smile solve sort spell spread step study suppose swim test throw tie trust ' +
      'type visit wake wash wear wish wonder belong happen matter care exist depend contain deserve feel'),
    IRREG: set('said got made went gone known knew took taken saw seen came thought looked gave given used found told ' +
      'felt left kept began begun held brought wrote written sat stood lost paid met set learnt understood ' +
      'spent grew won bought sent built stayed fell cut put become became ate eaten drank slept sang drove ' +
      'driven chose chosen flew flown forgot forgotten hid hidden hit hurt lay laid led meant read rode rang rose ' +
      'shook shut spoke spoken stuck taught threw thrown tied woke worn wore did done had has was were is are am')
  };

  var ADJ_SUFFIX = /(ful|ous|ive|able|ible|less|ish|ical|ic|ary|ant|ent|al)$/;
  var NOT_ADJ = set('animal signal festival hospital capital interval proposal arrival survival approval ' +
    'student parent agent event moment comment content element client percent cent talent document government ' +
    'environment equipment management statement treatment development experiment payment restaurant assistant ' +
    'giant plant elephant summary library salary dictionary secretary january february topic music logic ' +
    'traffic garlic picnic panic magic public clinic graphic graphics mechanic critic relative ' +
    'detective objective executive native motive initiative adjective archive perspective ' +
    'table cable vegetable fable stable bible mystery'.replace(/stable /, ''));

  function verbStem(w) {
    if (EN.VERB[w] || EN.IRREG[w]) return w;
    var m;
    if ((m = /^(.+?)(ies)$/.exec(w)) && EN.VERB[m[1] + 'y']) return m[1] + 'y';
    if ((m = /^(.+?)(es|s)$/.exec(w)) && (EN.VERB[m[1]] || EN.VERB[w.slice(0, -1)])) return EN.VERB[m[1]] ? m[1] : w.slice(0, -1);
    if ((m = /^(.+?)(ied)$/.exec(w)) && EN.VERB[m[1] + 'y']) return m[1] + 'y';
    if ((m = /^(.+?)(ed|d)$/.exec(w))) {
      if (EN.VERB[m[1]]) return m[1];
      if (EN.VERB[w.slice(0, -1)]) return w.slice(0, -1);
      if (/(.)\1$/.test(m[1]) && EN.VERB[m[1].slice(0, -1)]) return m[1].slice(0, -1);
    }
    if ((m = /^(.+?)ing$/.exec(w))) {
      if (EN.VERB[m[1]]) return m[1];
      if (EN.VERB[m[1] + 'e']) return m[1] + 'e';
      if (/(.)\1$/.test(m[1]) && EN.VERB[m[1].slice(0, -1)]) return m[1].slice(0, -1);
    }
    return null;
  }

  /** Lexical guess for one word, before context. */
  function lexEN(raw, w, isStart) {
    if (!w) return 'X';
    if (/^\d/.test(w) || /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|billion)$/.test(w)) return 'NUM';
    if (EN.PRON_AUX.test(w)) return 'PRONAUX';
    if (EN.NEG_CONTR.test(w)) return 'NEGAUX';
    if (w === 'to') return 'TO';
    if (EN.NEG[w]) return 'NEG';
    if (EN.POSS[w]) return 'POSS';
    if (EN.DET[w]) return 'DET';
    if (EN.QUANT[w]) return 'QUANT';
    if (EN.AUX[w]) return EN.COP[w] ? 'COP' : 'AUX';
    if (EN.PRON[w]) return 'PRON';
    if (EN.CONJ[w]) return 'CONJ';
    if (EN.REL[w]) return 'REL';
    if (EN.PREP[w]) return 'PREP';
    if (EN.PREP_CONJ[w]) return 'PREPCONJ';
    if (EN.INTJ[w]) return 'INTJ';
    if (/'s$/.test(w)) return 'GEN';                       // John's, the car's
    if (!isStart && /^\p{Lu}/u.test(raw)) return 'PROPN';
    if (EN.ADV[w]) return 'ADV';
    if (EN.ADJ[w]) return 'ADJ';
    if (/ly$/.test(w) && w.length > 4 && !/(ily|ply|ally)$/.test(w.slice(-3)) && w !== 'family' && w !== 'reply' && w !== 'supply' && w !== 'only') return 'ADV';
    var stem = verbStem(w);
    if (stem) return stem === w && !EN.IRREG[w] ? 'V' : /ing$/.test(w) ? 'VING' : (/ed$/.test(w) || EN.IRREG[w]) ? 'VED' : 'V';
    if (ADJ_SUFFIX.test(w) && w.length > 5 && !NOT_ADJ[w]) return 'ADJ';
    if (/ing$/.test(w) && w.length > 5) return 'VING';
    if (/ed$/.test(w) && w.length > 4) return 'VED';
    return 'N';
  }

  /** The bundled English grammar library (js/vendor/compromise.js), if available. */
  function getNlp() {
    if (typeof nlp === 'function') return nlp;                      // panel: global from the script tag
    if (typeof module === 'object' && typeof require === 'function') {
      try { return require('./vendor/compromise.js'); } catch (e) { /* not bundled */ }
    }
    return null;
  }

  /** Tags from the library for every word (union of the tags of its terms). */
  function libraryTags(words, lib) {
    var text = '', starts = [];
    words.forEach(function (w, i) { starts.push(text.length); text += w.text + (i < words.length - 1 ? ' ' : ''); });
    var out = words.map(function () { return []; });
    lib(text).json({ offset: true }).forEach(function (sent) {
      sent.terms.forEach(function (t) {
        var off = t.offset ? t.offset.start : -1;
        if (off < 0) return;
        var lo = 0, hi = starts.length - 1;
        while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
        Array.prototype.push.apply(out[lo], t.tags);
      });
    });
    return out;
  }

  var CLOSED = ['NUM', 'PRONAUX', 'NEGAUX', 'TO', 'NEG', 'POSS', 'DET', 'QUANT', 'AUX', 'COP', 'PRON', 'CONJ', 'REL', 'PREP', 'PREPCONJ', 'INTJ', 'GEN'];

  /** Content-word tag from the library's tags (function words keep our own lists). */
  function fromLibrary(lex, lt, raw, w, isStart) {
    if (CLOSED.indexOf(lex) >= 0 || !lt.length) return lex;
    var has = function (t) { return lt.indexOf(t) >= 0; };
    if (has('Particle')) return 'PRT';
    if (has('Expression')) return 'INTJ';
    if (has('Ordinal')) return 'ADJ';
    if (has('Value') || has('Cardinal')) return 'NUM';
    if (has('ProperNoun') && /^\p{Lu}/u.test(raw)) return 'PROPN';
    if (has('Adjective')) return 'ADJ';
    if (has('Adverb')) return 'ADV';
    if (has('Gerund')) return 'VING';
    if (has('Verb')) return (has('PastTense') || has('Participle')) ? 'VED' : 'V';
    if (has('Noun')) return 'N';
    return lex;
  }

  var NOMINAL = set('N PROPN NUM GEN NMOD');
  var ADJLIKE = set('ADJ VING VED');

  function tagEN(words, opts) {
    var n = words.length, tags = new Array(n), i;
    var low = words.map(function (w) { return clean(w.text); });
    var lib = opts && opts.engine === 'own' ? null : getNlp();
    var lt = null;
    if (lib) { try { lt = libraryTags(words, lib); } catch (e) { lt = null; } }
    for (i = 0; i < n; i++) {
      var sentStart = i === 0 || /[.!?…]["'”’)]*$/.test(words[i - 1].text);
      tags[i] = lexEN(words[i].text, low[i], sentStart);
      if (lt) tags[i] = fromLibrary(tags[i], lt[i], words[i].text, low[i], sentStart);
      if (sentStart && tags[i] === 'N' && /^\p{Lu}/u.test(words[i].text) && i + 1 < n && /^\p{Lu}/u.test(words[i + 1].text)) tags[i] = 'PROPN';
    }
    // "every single one", "the red one", "this one": "one" is the head noun, not a number.
    for (i = 1; i < n; i++) {
      if ((low[i] === 'one' || low[i] === 'ones') && /^(DET|ADJ|QUANT|POSS)$/.test(tags[i - 1]) && !trailingPunct(words[i - 1].text)) tags[i] = 'N';
    }
    // Context rules.
    for (i = 0; i < n; i++) {
      var t = tags[i], prev = i > 0 ? tags[i - 1] : null, next = i + 1 < n ? tags[i + 1] : null;
      var prevPunct = i > 0 && trailingPunct(words[i - 1].text);
      // "to" + verb is an infinitive; otherwise a preposition.
      if (t === 'TO') {
        var nv = next && verbStem(low[i + 1]) && !/ed$/.test(low[i + 1]);
        tags[i] = (next === 'V' || ((next === 'N' || next === 'VED') && nv) || next === 'ADV') ? 'PART' : 'PREP';
        if (tags[i] === 'PART' && next !== 'ADV') tags[i + 1] = 'V';
      }
      // After an article/possessive/adjective, a verb-looking word is a noun or adjective ("the cut", "a running joke").
      if ((t === 'V' || t === 'VING' || t === 'VED') && prev && !prevPunct && (prev === 'DET' || prev === 'POSS' || prev === 'ADJ' || prev === 'QUANT' || prev === 'NUM' || prev === 'GEN')) {
        tags[i] = (next && !trailingPunct(words[i].text) && NOMINAL[next]) ? 'ADJ' : 'N';
      }
      // A noun right after "to"/a helper/a subject pronoun is usually a verb ("I need to cut", "we split").
      if (t === 'N' && prev && !prevPunct && (prev === 'PART' || prev === 'AUX' || prev === 'NEGAUX' || prev === 'NEG' || (prev === 'PRON' && EN.SUBJ[low[i - 1]]) || prev === 'PRONAUX') && verbStem(low[i])) tags[i] = 'V';
      if ((t === 'VING' || t === 'VED') && prev && (prev === 'AUX' || prev === 'COP' || prev === 'PRONAUX' || prev === 'NEGAUX')) tags[i] = 'V';
      // "that"/"which" before a noun is a determiner ("that house").
      if (t === 'REL' && (low[i] === 'that' || low[i] === 'which' || low[i] === 'what') && next && (NOMINAL[next] || next === 'ADJ') && !trailingPunct(words[i].text)) tags[i] = 'DET';
      // after/before/since + noun phrase = preposition, + clause = conjunction
      if (t === 'PREPCONJ') tags[i] = (next === 'PRON' && EN.SUBJ[low[i + 1]]) || next === 'PRONAUX' ? 'CONJ' : 'PREP';
      // "so much", "so good": intensifier, not a conjunction.
      if (low[i] === 'so' && next && (ADJLIKE[next] || next === 'QUANT' || next === 'ADV') && !trailingPunct(words[i].text)) tags[i] = 'ADV';
      // Participles after an intensifier are adjectives ("really talented").
      if ((t === 'VED' || t === 'VING') && prev === 'ADV' && EN.INTENS[low[i - 1]] && !prevPunct) tags[i] = 'ADJ';
      // A particle after a verb ("pick up", "find out").
      if ((t === 'PREP' || t === 'ADV') && EN.PARTICLE[low[i]] && prev && (prev === 'V' || prev === 'VED' || prev === 'VING') && !prevPunct) {
        var trueParticle = /^(up|out|down|off|away|back|apart|aside|together)$/.test(low[i]);
        if (!next || trailingPunct(words[i].text) || next === 'PREP' || next === 'CONJ' ||
            (trueParticle && (next === 'DET' || next === 'POSS' || next === 'PRON')) ||
            ((next === 'ADJ' || next === 'ADV' || next === 'NUM' || next === 'N') && /^(back|away|out|home|down|off|over|around)$/.test(low[i]))) tags[i] = 'PRT';
      }
    }
    // Adjective chains before a noun: "beautiful old wooden house", "my younger brother", "a shiny red car".
    for (i = n - 2; i >= 0; i--) {
      if (trailingPunct(words[i].text)) continue;
      var t2 = tags[i], nx = tags[i + 1], pv = i > 0 ? tags[i - 1] : null;
      var beforeNoun = NOMINAL[nx] || nx === 'ADJ';
      if ((t2 === 'N' || t2 === 'VING' || t2 === 'VED') && ADJ_SUFFIX.test(low[i]) && !NOT_ADJ[low[i]] && NOMINAL[nx]) tags[i] = 'ADJ';
      else if (t2 === 'N' && beforeNoun && (pv === 'DET' || pv === 'POSS' || pv === 'GEN' || pv === 'ADJ' || pv === 'NUM' || (pv === 'ADV' && EN.INTENS[low[i - 1]])) &&
        /(er|est|y)$/.test(low[i]) && low[i].length > 3) tags[i] = 'ADJ';
      else if ((t2 === 'VED' || t2 === 'VING') && beforeNoun && (pv === 'DET' || pv === 'POSS' || pv === 'ADJ' || pv === 'ADV')) tags[i] = 'ADJ';
      else if (low[i] === 'little' && NOMINAL[nx] && (pv === 'ADJ' || pv === 'DET' || pv === 'POSS')) tags[i] = 'ADJ';
      else if (t2 === 'N' && nx === 'ADJ' && (pv === 'DET' || pv === 'POSS' || pv === 'GEN' || pv === 'ADJ' || pv === 'NUM')) tags[i] = 'ADJ';
    }
    // After a plural determiner the phrase ends in a plural noun: "those tiny warning signs".
    for (i = 1; i < n; i++) {
      if (!(tags[i] === 'V' && /s$/.test(low[i])) || trailingPunct(words[i - 1].text)) continue;
      for (var j = i - 1; j >= Math.max(0, i - 4); j--) {
        if (/^(those|these|many|several|both|few|various|all|some|such|my|your|his|her|our|their)$/.test(low[j]) && (tags[j] === 'DET' || tags[j] === 'QUANT' || tags[j] === 'POSS')) {
          if (j < i - 1 && tags[i - 1] !== 'V') tags[i] = 'N';
          break;
        }
        if (!/^(ADJ|N|NMOD|ADV)$/.test(tags[j]) || trailingPunct(words[j].text)) break;
      }
    }
    // Noun modifiers inside a noun phrase, left to right: "the vintage silk dress", "a cheap coffee shop".
    for (i = 1; i < n - 1; i++) {
      if (trailingPunct(words[i].text) || trailingPunct(words[i - 1].text)) continue;
      if (tags[i] === 'N' && NOMINAL[tags[i + 1]] && tags[i + 1] !== 'NUM' && /^(DET|POSS|GEN|ADJ|NUM|NMOD)$/.test(tags[i - 1])) tags[i] = 'NMOD';
    }
    return tags;
  }

  /**
   * How strongly two neighbouring English words belong together:
   * 1 = never split, 0 = neutral, negative = a good place to break.
   */
  function cohesionEN(L, R, lw, rw) {
    switch (L) {
      case 'CONJ': return 1;                                   // "and | then" → keep "and" with what follows
      case 'DET': case 'POSS': case 'GEN':
        return (NOMINAL[R] || ADJLIKE[R] || R === 'ADV' || R === 'QUANT') ? 1 : 0.5;
      case 'QUANT': case 'NUM':
        return (NOMINAL[R] || ADJLIKE[R]) ? 1 : 0;
      case 'ADJ':
        return (NOMINAL[R] || R === 'ADJ') ? 1 : (R === 'PART' ? 0.4 : 0);
      case 'ADV':
        if (EN.INTENS[lw] && (ADJLIKE[R] || R === 'ADV' || R === 'QUANT')) return 1;   // "really | talented"
        return (R === 'V' || R === 'VED' || R === 'VING') ? 0.5 : (ADJLIKE[R] ? 0.8 : 0);
      // "in | the middle": strong, but a little weaker than splits inside the noun phrase itself,
      // so when something has to give, "to | the annual charity gala" beats "to the annual | charity gala".
      case 'PREP': return (R === 'DET' || R === 'POSS' || R === 'QUANT' || R === 'NUM') ? 0.85 : 1;
      case 'PART': case 'TO': return 1;                        // "to | read"
      case 'AUX': case 'NEGAUX':
        return (R === 'V' || R === 'VED' || R === 'VING' || R === 'AUX' || R === 'COP' || R === 'NEG' || R === 'ADV' || R === 'PRON') ? 1 : 0.6;
      case 'COP': case 'PRONAUX':
        if (R === 'V' || R === 'VED' || R === 'VING') return 1;   // "are | going", "has been | working", "was | built"
        return (R === 'V' || R === 'VED' || R === 'VING' || R === 'NEG' || R === 'ADV' || ADJLIKE[R] || R === 'DET' || R === 'PART') ? 0.7 : 0.4;
      case 'NEG':
        return (R === 'V' || R === 'VED' || R === 'VING' || R === 'AUX' || R === 'COP' || ADJLIKE[R] || R === 'ADV' || R === 'DET') ? 1 : 0.6;
      case 'PRON':
        if (/(thing|one|body)$/.test(lw) && (ADJLIKE[R] || R === 'ADV')) return 1;   // "something new", "nobody else"
        return EN.SUBJ[lw] && (R === 'V' || R === 'VED' || R === 'AUX' || R === 'COP' || R === 'NEG' || R === 'NEGAUX' || R === 'ADV') ? 0.7 : (R === 'PRT' ? 0.8 : 0);
      case 'V': case 'VED': case 'VING':
        if (R === 'PRT') return 0.9;                           // "pick | up"
        if (R === 'PART' && /^(going|gonna|got|have|has|had|used|supposed|able|ought|want|wants|wanted|need|needs|needed|try|trying|tried)$/.test(lw)) return 1;   // "going | to talk"
        if (R === 'DET' || R === 'POSS' || R === 'PRON' || NOMINAL[R] || R === 'PART' || ADJLIKE[R] || R === 'NUM') return 0.4;
        return 0;
      case 'NMOD': return 1;                                   // "coffee | shop" inside a noun phrase
      case 'N': case 'PROPN':
        if (R === 'N' || R === 'PROPN') return L === 'PROPN' && R === 'PROPN' ? 1 : 0.6;   // compound nouns, names
        if (R === 'PRT') return 0.8;
        return 0;
      case 'REL': return 0.8;                                  // "which | means"
      default: return 0;
    }
  }

  /** Good places to break (start of a new phrase / clause). */
  function breakBonusEN(L, R, lw, rw) {
    if (R === 'CONJ' || R === 'REL') return -0.5;             // break before "and", "because", "which"
    if (R === 'PREP' && (NOMINAL[L] || L === 'V' || L === 'VED' || L === 'VING' || L === 'ADJ' || L === 'ADV' || L === 'PRON' || L === 'PRT')) return -0.3;
    if (R === 'PREPCONJ') return -0.3;
    if ((R === 'PRON' && EN.SUBJ[rw]) || R === 'PRONAUX') {
      if (NOMINAL[L] || L === 'V' || L === 'VED' || L === 'ADJ' || L === 'ADV' || L === 'PRT' || L === 'PRON') return -0.3;  // new clause
    }
    if (R === 'PART' && (NOMINAL[L] || L === 'ADJ')) return -0.15;
    return 0;
  }

  // ---------------------------------------------------------------- Turkish

  var TR = {
    DET: set('bu şu o bunlar şunlar her bazı hiçbir birkaç bütün tüm birçok herhangi öbür diğer aynı'),
    NUM: set('bir iki üç dört beş altı yedi sekiz dokuz on yirmi otuz kırk elli altmış yetmiş seksen doksan yüz bin ' +
      'milyon milyar ilk ikinci üçüncü son yarım'),
    INTENS: set('çok daha en pek gayet oldukça biraz epey az fazla bayağı gerçekten tam'),
    ADV: set('bugün yarın dün şimdi hep hiç artık zaten belki hemen burada orada şurada böyle şöyle öyle sadece ' +
      'yine tekrar hala hâlâ henüz bazen asla aslında galiba herhalde mutlaka kesinlikle birlikte beraber önce ' +
      'hızla yavaşça iyice'),
    CONJ: set('ve veya ya yahut ama fakat ancak lakin çünkü ki hem de da yani sonra ayrıca oysa halbuki eğer ' +
      'madem rağmen'),
    POSTP: set('için gibi kadar göre karşı rağmen beri dolayı doğru dek değin üzere ile sonra önce itibaren boyunca ' +
      'olarak üzerinde üzerine üzerinden hakkında sırasında yüzünden sayesinde karşısında altında altına içinde ' +
      'içine dışında yanında yanına önünde arkasında arasında arasına sonunda başında ortasında etrafında ' +
      'nedeniyle aracılığıyla tarafından'),
    PART: set('mi mı mu mü misin mısın musun müsün miyim mıyım muyum müyüm miyiz mıyız muyuz müyüz misiniz mısınız ' +
      'musunuz müsünüz midir mıdır mudur müdür miydi mıydı muydu müydü değil değilim değilsin değiliz değilsiniz ' +
      'değiller değildi değilmiş de da dahi bile'),
    ADJ: set('büyük küçük güzel yeni eski iyi kötü uzun kısa önemli zor kolay farklı ilginç genç yaşlı sıcak soğuk ' +
      'hızlı yavaş doğru yanlış gerçek özel temel basit açık kapalı kırmızı mavi yeşil beyaz siyah sarı mor pembe ' +
      'harika mükemmel gerekli mümkün imkansız güçlü zayıf ağır hafif derin geniş dar kalın ince yumuşak sert ' +
      'tatlı acı tuzlu ekşi temiz kirli zengin fakir mutlu mutsuz üzgün kızgın yorgun hasta sağlıklı tehlikeli ' +
      'güvenli ucuz pahalı boş dolu yakın uzak erken geç ana asıl genel tam bütün değerli faydalı başarılı ' +
      'yeterli harika muhteşem korkunç berbat sessiz yüksek alçak karanlık aydınlık parlak sakin net'),
    VERB_END: /(yor(um|sun|uz|sunuz|lar)?|acağ(ım|ız)|eceğ(im|iz)|acak(sın|sınız|lar)?|ecek(sin|siniz|ler)?|(d|t)(ı|i|u|ü)(m|n|k|nız|niz|nuz|nüz|lar|ler)?|m(ı|i|u|ü)ş(ım|im|um|üm|sın|sin|sun|sün|ız|iz|uz|üz|lar|ler)?|malı|meli|malıyız|meliyiz|abilir|ebilir|(ı|i|u|ü)r(ım|im|um|üm|sın|sin|sun|sün|ız|iz|uz|üz|lar|ler)|mak|mek|alım|elim|sın|sin)$/,
    GEN: /[^aeıioöuü](ın|in|un|ün)$|n(ın|in|un|ün)$/,
    ADJ_SUFFIX: /(lı|li|lu|lü|sız|siz|suz|süz|sal|sel|ki|daki|deki|taki|teki|ıcı|ici|ucu|ücü)$/
  };

  /** Zemberek-derived Turkish word lists (js/data/tr-lexicon.js), loaded lazily. */
  var trLex = null;
  function getTRLexicon(opts) {
    if (opts && opts.engine === 'own') return null;
    if (trLex !== null) return trLex || null;
    var data = null;
    if (typeof SmartTRLexicon === 'object' && SmartTRLexicon) data = SmartTRLexicon;
    else if (typeof module === 'object' && typeof require === 'function') {
      try { data = require('./data/tr-lexicon.js'); } catch (e) { data = null; }
    }
    trLex = data ? { adj: set(data.adj), adv: set(data.adv), conj: set(data.conj), postp: set(data.postp),
      det: set(data.det), pron: set(data.pron), verb: set(data.verb) } : false;
    return trLex || null;
  }

  var TR_VERB_SUFFIX = /^(y?(ı|i|u|ü|a|e)?yor|(y)?(acak|ecek|acağ|eceğ)|(d|t)(ı|i|u|ü)|m(ı|i|u|ü)ş|ma(lı|z|dı|mış|yacak|sın)|me(li|z|di|miş|yecek|sin)|(a|e|ı|i|u|ü)?r(ım|im|um|üm|sın|sin|sun|sün|ız|iz|uz|üz|lar|ler|dı|di|du|dü|mış|miş)?$|(y)?abil|(y)?ebil|sa(m|n|k|nız|lar)?$|se(m|n|k|niz|ler)?$|(y)?(alım|elim)$|(y)?(ın|in|un|ün|ınız|iniz)$|mak|mek)/;

  /** "göstereceğim" → root "göster" + a verb ending. */
  function isTurkishVerb(w, lex) {
    if (!lex) return false;
    for (var k = Math.min(w.length - 1, 10); k >= 3; k--) {
      if (lex.verb[w.slice(0, k)] && TR_VERB_SUFFIX.test(w.slice(k))) return true;
    }
    return false;
  }

  function tagTR(words, opts) {
    var lex = getTRLexicon(opts);
    var low = words.map(function (w) { return clean(w.text).replace(/'.*$/, ''); });
    return low.map(function (w, i) {
      var raw = words[i].text;
      if (!w) return 'X';
      if (/^\d/.test(w)) return 'NUM';
      if (TR.CONJ[w]) return w === 'de' || w === 'da' ? 'PART' : 'CONJ';
      if (TR.POSTP[w]) return 'POSTP';
      if (TR.PART[w]) return 'PART';
      if (TR.DET[w]) return 'DET';
      if (TR.NUM[w]) return 'NUM';
      if (TR.INTENS[w]) return 'INTENS';
      if (TR.ADJ[w]) return 'ADJ';
      if (TR.ADV[w]) return 'ADV';
      if (lex) {
        if (lex.det[w]) return 'DET';
        if (lex.adj[w] && !lex.verb[w]) return 'ADJ';
        if (lex.adv[w]) return 'ADV';
        if (lex.conj[w] && w.length > 2) return 'CONJ';
      }
      if (i > 0 && /^\p{Lu}/u.test(raw) && !/[.!?…]["'”’)]*$/.test(words[i - 1].text)) return 'PROPN';
      // participles used as adjectives: "gelen adam", "okuduğum kitap", "annemin yaptığı turta"
      // (but not the ablative "-dan/-den/-tan/-ten": "barınaktan")
      if (/(dığı|diği|duğu|düğü|tığı|tiği|tuğu|tüğü|dığım|diğim|duğum|düğüm|dığın|diğin|duğun|düğün|dığımız|diğimiz)$/.test(w) && w.length > 4) return 'PTCP';
      if (/[^dt](an|en)$|yan$|yen$/.test(w) && !/(dan|den|tan|ten)$/.test(w) && w.length > 4 && isTurkishVerb(w.replace(/y?(an|en)$/, '') + 'mak', lex)) return 'PTCP';
      // "-malı/-meli": verb ("yapmalı" = must do) only after a real verb root; else "with …" ("elmalı" = with apples)
      var mustVerb = /(malı|meli)$/.test(w) && w.length - 4 >= 3 && lex && lex.verb[w.slice(0, -4)];
      if (TR.ADJ_SUFFIX.test(w) && w.length > 4 && !mustVerb) return 'ADJ';
      if ((TR.VERB_END.test(w) && w.length > 4) || isTurkishVerb(w, lex)) return 'V';
      if (TR.ADJ_SUFFIX.test(w) && w.length > 4) return 'ADJ';
      if (TR.GEN.test(w) && w.length > 4) return 'GEN';
      if (/[^dt](an|en)$/.test(w) && !/(dan|den|tan|ten)$/.test(w) && w.length > 5) return 'PTCP';
      return 'N';
    });
  }

  function cohesionTR(L, R) {
    var nounish = R === 'N' || R === 'ADJ' || R === 'NUM' || R === 'PROPN' || R === 'GEN' || R === 'PTCP' || R === 'INTENS';
    if (R === 'POSTP' || R === 'PART') return 1;          // "ev | için", "geldi | mi"
    if (L === 'CONJ') return 1;
    if (L === 'DET' || L === 'NUM' || L === 'ADJ' || L === 'PTCP') return nounish ? 1 : 0.2;   // "güzel | bir | ev"
    if (L === 'INTENS') return R === 'V' ? 0.6 : 1;      // "çok | önemli"
    if (L === 'GEN') return nounish ? 0.8 : 0.3;         // "evin | kapısı"
    if (L === 'PROPN' && R === 'PROPN') return 1;
    if (L === 'N' && R === 'N') return 0.5;
    if (L === 'N' && R === 'V') return 0.4;              // object + verb at clause end
    if (L === 'ADV' && (R === 'V' || R === 'ADJ')) return 0.4;
    return 0;
  }

  function breakBonusTR(L, R) {
    if (R === 'CONJ') return -0.5;                       // break before "ve", "ama", "çünkü"
    if (L === 'V') return -0.4;                          // after a verb: the clause has ended
    return 0;
  }

  // ---------------------------------------------------------------- public

  /**
   * Cohesion for every boundary: result[b] is how strongly words[b-1] and
   * words[b] belong together (1 = keep together, negative = good break).
   */
  var cache = { key: null, value: null };

  function analyze(words, lang, opts) {
    var n = words.length, coh = new Float64Array(n + 1);
    if (lang !== 'en' && lang !== 'tr') return { tags: null, cohesion: coh };
    var key = lang + '|' + (opts && opts.engine || '') + '|' + words.map(function (w) { return w.text; }).join(' ');
    if (cache.key === key) return cache.value;
    var tags = lang === 'en' ? tagEN(words, opts) : tagTR(words, opts);
    var low = words.map(function (w) { return clean(w.text); });
    for (var b = 1; b < n; b++) {
      var L = tags[b - 1], R = tags[b];
      if (trailingPunct(words[b - 1].text)) { coh[b] = -0.3; continue; }   // punctuation: natural break
      var c = lang === 'en' ? cohesionEN(L, R, low[b - 1], low[b]) : cohesionTR(L, R);
      var bonus = lang === 'en' ? breakBonusEN(L, R, low[b - 1], low[b]) : breakBonusTR(L, R);
      coh[b] = c > 0 ? c : bonus;
      if (c > 0 && bonus < 0 && c < 0.5) coh[b] = bonus;     // weak link but a clear phrase start

    }
    // Coordinated adjectives belong together: "a melancholic | but | hopeful ending".
    if (lang === 'en') {
      for (b = 1; b < n - 1; b++) {
        // left side: an adjective, or a word the tagger called a noun right after "a/the/my…" ("a melancholic but…")
        var leftOk = ADJLIKE[tags[b - 1]] || (tags[b - 1] === 'N' && b >= 2 && /^(DET|POSS|GEN|ADJ|ADV)$/.test(tags[b - 2]));
        if (!leftOk || !/^(and|or|but|yet)$/.test(low[b]) || trailingPunct(words[b - 1].text)) continue;
        var k = b + 1;
        while (k < n && (tags[k] === 'ADJ' || tags[k] === 'ADV' || tags[k] === 'VED') && !trailingPunct(words[k - 1].text)) k++;
        if (k > b + 1 && k < n && NOMINAL[tags[k]]) for (var q = b; q <= k; q++) coh[q] = Math.max(coh[q], 1);
      }
    }
    var result = { tags: tags, cohesion: coh };
    cache.key = key; cache.value = result;
    return result;
  }

  function hasLibrary() { return !!getNlp(); }

  return { analyze: analyze, tagEN: tagEN, tagTR: tagTR, hasLibrary: hasLibrary };
}));
