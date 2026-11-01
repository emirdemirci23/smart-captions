'use strict';
/*
 * Hand-marked phrases that must never be split across captions (or across the
 * two lines of a caption). Used to compare phrasing versions independently of
 * the tagger itself: node tests/phrasing-gold.js
 */
module.exports = [
  ['The film had a melancholic but hopeful ending that surprised everyone in the crowded theater.', ['a melancholic but hopeful ending', 'the crowded theater']],
  ['She wore a vintage silk dress to the annual charity gala last night.', ['a vintage silk dress', 'the annual charity gala', 'last night']],
  ['We hiked through lush tropical rainforest for three exhausting days.', ['lush tropical rainforest', 'three exhausting days']],
  ['My grandmother makes the most delicious homemade apple pie in the entire neighborhood.', ['My grandmother', 'the most delicious homemade apple pie', 'the entire neighborhood']],
  ['The startup released a sleek minimalist app for busy remote workers.', ['a sleek minimalist app', 'busy remote workers']],
  ['Honestly, the soundtrack was haunting and the cinematography was breathtaking.', ['the soundtrack', 'the cinematography']],
  ['He bought a refurbished laptop with a crisp bright display and a surprisingly long battery life.', ['a refurbished laptop', 'a crisp bright display', 'a surprisingly long battery life']],
  ['They live in a cozy little cottage on a windy hill above the sleepy fishing village.', ['a cozy little cottage', 'a windy hill', 'the sleepy fishing village']],
  ['You should never ignore those tiny warning signs in your daily routine.', ['should never ignore', 'those tiny warning signs', 'your daily routine']],
  ['The chef prepared an elaborate seven course dinner with fresh local ingredients.', ['an elaborate seven course dinner', 'fresh local ingredients']],
  ['We are going to talk about the biggest mistakes that new video editors make.', ['are going to talk', 'the biggest mistakes', 'new video editors']],
  ['Our team has been working on this ambitious project for almost two years.', ['has been working', 'this ambitious project', 'almost two years']],
  ['If you want crisp clear audio, buy a decent lavalier microphone and a sturdy stand.', ['crisp clear audio', 'a decent lavalier microphone', 'a sturdy stand']],
  ['The quiet old librarian handed me a dusty leather notebook full of strange handwritten notes.', ['The quiet old librarian', 'a dusty leather notebook', 'strange handwritten notes']],
  ['It was a genuinely terrifying experience that I will never forget.', ['a genuinely terrifying experience', 'will never forget']],
  ['Please pick up the heavy wooden boxes before the delivery truck arrives.', ['pick up', 'the heavy wooden boxes', 'the delivery truck']],
  ['The new update brings smoother animations, faster loading times and several hidden features.', ['The new update', 'smoother animations', 'faster loading times', 'several hidden features']],
  ['Every single viewer deserves accurate and readable captions on every video.', ['Every single viewer', 'accurate and readable captions', 'every video']],
  ['My younger brother just adopted an adorable rescue puppy from the local shelter.', ['My younger brother', 'an adorable rescue puppy', 'the local shelter']],
  ['That was the most exciting football match I have watched in a very long time.', ['the most exciting football match', 'a very long time']],
];
