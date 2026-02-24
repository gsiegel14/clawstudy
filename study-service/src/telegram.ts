function firstSentence(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const match = trimmed.match(/(.+?[.!?])(\s|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return trimmed;
}

function trimToLength(input: string, maxLength: number): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1).trim()}…`;
}

export function buildQuestionText(input: {
  questionNumber: number;
  stem: string;
  choices: string[];
}): string {
  const choiceLines = input.choices.map((choice, index) => {
    const prefix = ['A', 'B', 'C', 'D'][index] ?? `${index + 1}`;
    return `${prefix}. ${choice}`;
  });

  return [`Question ${input.questionNumber}`, input.stem, ...choiceLines].join('\n');
}

export function buildImageDescription(input: {
  imageRef: string | null;
  stem: string;
  explanation: string;
}): string | null {
  if (!input.imageRef) {
    return null;
  }

  const fromExplanation = firstSentence(input.explanation);
  if (fromExplanation.length > 0) {
    return trimToLength(fromExplanation, 220);
  }

  const fromStem = firstSentence(input.stem);
  if (fromStem.length > 0) {
    return trimToLength(`Ultrasound figure context: ${fromStem}`, 220);
  }

  return 'Ultrasound figure context is relevant to this question.';
}

export function buildAnswerFeedback(input: {
  isCorrect: boolean;
  explanation: string;
  progress: { questionsAnswered: number; questionsCorrect: number; accuracy: number };
}): string {
  const pct = (input.progress.accuracy * 100).toFixed(0);
  return [
    input.isCorrect ? 'Correct.' : 'Incorrect.',
    input.explanation,
    `Progress: ${input.progress.questionsCorrect}/${input.progress.questionsAnswered} (${pct}%)`,
  ].join('\n');
}
