// Minimal reproduction of Mole_Concept_21Q_Interactive.html's actual schema:
// no data-type, a numeric input, a data-answer key, and "Published answer".
export const moleConceptAnswers = [2,8,13,3,19,1,18,226,1,68,1,78,4,464,3,12,5,19,5,19,2];
export const moleConceptSource = '<title>Mole Concept | 21 Questions</title><h1>Mole Concept</h1>'
  + moleConceptAnswers.map((answer,index)=>`<article class="qcard" id="q${index+1}" data-q="${index+1}" data-answer="${answer}" data-tolerance="0.499999">
<div class="qhead"><div class="qnum">${index+1}</div><div class="qtop"><div class="qmeta"><span class="q-tag">Numerical (NAT)</span></div><div class="qtext">${index===0?'4.5 g of compound A (MW = 90) was used to make 250 mL of its aqueous solution. The molarity is <span class="math-shell" data-tex="x\\times10^{-1}"><math><mi>x</mi></math></span>. The value of x is ____ (nearest integer).':`Numerical question ${index+1}.`}</div></div></div>
<div class="numeric-line"><label>Numerical answer</label><input class="num-answer" type="number" value="999"></div>
<div class="edit-answer-row" hidden><input class="edit-answer-input" type="number" value="${answer}"></div>
<div class="correct-reveal"><strong>Correct answer:</strong> <span class="correct-number">${answer}</span></div>
<details class="solution"><summary>Show solution</summary><div class="solution-inner"><div class="answer">✓ Published answer: ${answer}</div><div class="worked"><p>Worked numerical solution.</p></div></div></details></article>`).join('');
