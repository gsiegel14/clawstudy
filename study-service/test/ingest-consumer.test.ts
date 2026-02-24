import { describe, expect, it } from 'vitest';
import { extractEmbeddedImageData, parseAuthoredQuestions } from '../src/ingest-consumer';

describe('ingest consumer parsing helpers', () => {
  it('parses authored MCQs in source order', () => {
    const markdown = [
      'Question 1 Which FAST window evaluates pericardial effusion?',
      'A. Subxiphoid cardiac',
      'B. Popliteal vein',
      'C. Ocular',
      'D. Thyroid',
      'Answer: A',
      '',
      'Question 2 A positive FAST most strongly suggests what?',
      'A. Intra-abdominal free fluid',
      'B. Hydronephrosis',
      'C. Portal venous gas',
      'D. Pleural effusion only',
      'Correct answer: A',
    ].join('\n');

    const parsed = parseAuthoredQuestions(markdown);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].sourceOrder).toBe(0);
    expect(parsed[0].correctChoice).toBe('A');
    expect(parsed[1].sourceOrder).toBe(1);
    expect(parsed[1].choices).toHaveLength(4);
  });

  it('parses compact authored MCQs when markdown has no line breaks', () => {
    const markdown = [
      'Question 1 uses the embedded image below.',
      'Question 1. Which FAST view best evaluates hepatorenal free fluid?',
      'A. Right upper quadrant (Morrison pouch) B. Transvaginal view C. Ocular view D. Supraclavicular view',
      'Answer: A',
      'Question 2. A positive FAST in trauma most strongly suggests which finding?',
      'A. Intra-abdominal free fluid B. Pleural effusion only C. Hydronephrosis D. Portal venous gas',
      'Answer: A',
    ].join(' ');

    const parsed = parseAuthoredQuestions(markdown);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].sourceOrder).toBe(0);
    expect(parsed[0].stem).toContain('hepatorenal free fluid');
    expect(parsed[0].choices[0]).toContain('Right upper quadrant');
    expect(parsed[0].choices[1]).toContain('Transvaginal');
    expect(parsed[0].correctChoice).toBe('A');
    expect(parsed[1].sourceOrder).toBe(1);
  });

  it('extracts embedded data-uri images from markdown', () => {
    const markdown = '![scan](data:image/png;base64,QUJDRA==)\n\nQuestion 1 ...';
    const result = extractEmbeddedImageData(markdown);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].mimeType).toBe('image/png');
    expect(result.markdownWithoutDataImages).toContain('[[embedded-image-1]]');
  });

  it('parses FAST-style authored MCQs with merged page markers and answer artifacts', () => {
    const answerFor = (index: number) => (['A', 'B', 'C', 'D'] as const)[(index - 1) % 4];
    const questionLines: string[] = [];
    const answerLines: string[] = [];

    for (let index = 1; index <= 31; index += 1) {
      const page = Math.floor((index + 2) / 2);
      questionLines.push(`### Page ${page}`);
      questionLines.push(
        `${index}. FAST stem ${index} asks for the next step with Figure 1.${index} and Video 1.${index}.`,
      );
      if (index % 2 === 0) {
        questionLines.push(`A. option A ${index}B. option B ${index}C. option C ${index}D. option D ${index}`);
      } else {
        questionLines.push(`a. option a ${index}b. option b ${index}c. option c ${index}d. option d ${index}`);
      }
      questionLines.push('Downloaded from https://academic.oup.com/book/test by user on 01 January 2026');

      const answer = answerFor(index);
      if (index === 1) {
        answerLines.push(`p. 91. Explanation${answer}. Rationale ${index}.`);
      } else if (index === 21) {
        answerLines.push(`p. 1921. Explanation${answer}. Rationale ${index}.`);
      } else {
        answerLines.push(`${index}. Explanation${answer}. Rationale ${index}.`);
      }
    }

    const markdown = [
      'This chapter uses multiple-choice questions to explore clinical FAST concepts.',
      '1. Focused Assessment with Sonography in Trauma',
      `Topics include pitfalls.Questions${questionLines.join('\n')}`,
      `Answers${answerLines.join('\n')}`,
    ].join('\n');

    const parsed = parseAuthoredQuestions(markdown);
    expect(parsed).toHaveLength(31);
    expect(parsed[0].sourceOrder).toBe(0);
    expect(parsed[30].sourceOrder).toBe(30);
    expect(parsed[0].correctChoice).toBe(answerFor(1));
    expect(parsed[20].correctChoice).toBe(answerFor(21));
    expect(parsed[30].choices).toEqual(['option a 31', 'option b 31', 'option c 31', 'option d 31']);
  });
});
