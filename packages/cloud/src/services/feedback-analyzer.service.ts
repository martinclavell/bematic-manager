/**
 * Analyzes feedback suggestions to find patterns and generate improvement recommendations
 * This enables the system to learn from user feedback and improve over time
 */

import { createLogger, type FeedbackAnalysis } from '@bematic/common';
import type { FeedbackSuggestionRepository } from '@bematic/db';

const logger = createLogger('feedback-analyzer');

interface ThemeCandidate {
  keywords: string[];
  count: number;
  examples: string[];
}

export class FeedbackAnalyzerService {
  constructor(private readonly feedbackRepo: FeedbackSuggestionRepository) {}

  /**
   * Analyze feedback suggestions within a date range
   */
  async analyze(fromDate: Date, toDate: Date): Promise<FeedbackAnalysis> {
    const suggestions = this.feedbackRepo.findByDateRange(fromDate.getTime(), toDate.getTime());

    if (suggestions.length === 0) {
      return {
        themes: [],
        improvements: [],
        totalSuggestions: 0,
        analyzedFrom: fromDate,
        analyzedTo: toDate,
      };
    }

    logger.info({ count: suggestions.length }, 'Analyzing feedback suggestions');

    // Group by category first
    const byCategory = this.groupByCategory(suggestions);

    // Extract common themes using simple keyword matching
    const themes = this.extractThemes(suggestions);

    // Generate improvement recommendations
    const improvements = this.generateImprovements(byCategory, themes);

    return {
      themes,
      improvements,
      totalSuggestions: suggestions.length,
      analyzedFrom: fromDate,
      analyzedTo: toDate,
    };
  }

  /**
   * Group suggestions by category
   */
  private groupByCategory(suggestions: any[]) {
    const grouped = new Map<string, any[]>();

    for (const suggestion of suggestions) {
      const category = suggestion.category || 'other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(suggestion);
    }

    return grouped;
  }

  /**
   * Extract common themes using keyword analysis
   */
  private extractThemes(suggestions: any[]): FeedbackAnalysis['themes'] {
    const keywords = new Map<string, ThemeCandidate>();

    // Common words to ignore
    const stopWords = new Set([
      'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
      'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
      'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
      'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
      'should', 'could', 'would', 'can', 'need', 'needs', 'please', 'make',
    ]);

    for (const suggestion of suggestions) {
      const text = (suggestion.suggestion + ' ' + (suggestion.context || '')).toLowerCase();
      const words = text
        .split(/\W+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      // Count significant words
      for (const word of words) {
        if (!keywords.has(word)) {
          keywords.set(word, {
            keywords: [word],
            count: 0,
            examples: [],
          });
        }

        const candidate = keywords.get(word)!;
        candidate.count++;
        if (candidate.examples.length < 3) {
          candidate.examples.push(suggestion.suggestion);
        }
      }
    }

    // Filter to top themes (mentioned in at least 3 suggestions)
    const themes = Array.from(keywords.values())
      .filter((t) => t.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10) // Top 10 themes
      .map((t) => ({
        theme: t.keywords[0],
        count: t.count,
        examples: t.examples.slice(0, 2), // Top 2 examples
      }));

    return themes;
  }

  /**
   * Generate improvement recommendations based on categories and themes
   */
  private generateImprovements(
    byCategory: Map<string, any[]>,
    themes: FeedbackAnalysis['themes']
  ): FeedbackAnalysis['improvements'] {
    const improvements: FeedbackAnalysis['improvements'] = [];

    // Analyze each category
    for (const [category, items] of byCategory.entries()) {
      if (items.length < 2) continue; // Need at least 2 suggestions to be significant

      const priority = items.length >= 5 ? 'high' : items.length >= 3 ? 'medium' : 'low';

      // Create improvement recommendation
      improvements.push({
        category,
        priority,
        description: this.summarizeCategory(category, items),
        relatedSuggestions: items.map((s) => s.id),
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    improvements.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return improvements;
  }

  /**
   * Create a summary description for a category
   */
  private summarizeCategory(category: string, items: any[]): string {
    const count = items.length;
    const examples = items.slice(0, 2).map((i) => i.suggestion);

    switch (category) {
      case 'response_quality':
        return `Improve response quality (${count} suggestions). Examples: ${examples.join('; ')}`;
      case 'code_quality':
        return `Improve code quality (${count} suggestions). Examples: ${examples.join('; ')}`;
      case 'documentation':
        return `Improve documentation (${count} suggestions). Examples: ${examples.join('; ')}`;
      case 'performance':
        return `Improve performance (${count} suggestions). Examples: ${examples.join('; ')}`;
      default:
        return `Address ${category} feedback (${count} suggestions). Examples: ${examples.join('; ')}`;
    }
  }

  /**
   * Get feedback statistics
   */
  getStats() {
    return this.feedbackRepo.getStats();
  }

  /**
   * Format analysis as Slack message
   */
  formatForSlack(analysis: FeedbackAnalysis): string {
    let message = `:chart_with_upwards_trend: *Feedback Analysis*\n`;
    message += `_${analysis.analyzedFrom.toLocaleDateString()} - ${analysis.analyzedTo.toLocaleDateString()}_\n\n`;
    message += `*Total Suggestions:* ${analysis.totalSuggestions}\n\n`;

    if (analysis.themes.length > 0) {
      message += `*Common Themes:*\n`;
      for (const theme of analysis.themes) {
        message += `• *${theme.theme}* (${theme.count} mentions)\n`;
      }
      message += `\n`;
    }

    if (analysis.improvements.length > 0) {
      message += `*Recommended Improvements:*\n`;
      for (const imp of analysis.improvements) {
        const emoji = imp.priority === 'high' ? ':fire:' : imp.priority === 'medium' ? ':warning:' : ':bulb:';
        message += `${emoji} *${imp.category}* (${imp.priority} priority)\n`;
        message += `  ${imp.description}\n\n`;
      }
    }

    return message;
  }
}
