import unittest
from unittest.mock import patch

import domora_rag as rag


class SourceFormattingTests(unittest.TestCase):
    def test_single_document_uses_singular_footer(self):
        self.assertEqual(
            rag.format_sources([{"title": "Estatutos", "page": 3}]),
            "📚 Fuente: Estatutos · página 3",
        )

    def test_multiple_documents_use_separate_bullets(self):
        self.assertEqual(
            rag.format_sources([
                {"title": "Estatutos", "page": 3},
                {"filename": "Acta.pdf", "page": 2},
            ]),
            "📚 Fuentes\n\n- Estatutos · página 3\n- Acta.pdf · página 2",
        )

    def test_pages_are_sorted_and_deduplicated_per_document(self):
        self.assertEqual(
            rag.format_sources([
                {"title": "Estatutos", "page": 3},
                {"title": "Estatutos", "page": 1},
                {"title": "Estatutos", "page": 3},
            ]),
            "📚 Fuente: Estatutos · páginas 1, 3",
        )

    def test_missing_page_is_not_invented(self):
        self.assertEqual(
            rag.format_sources([{"title": "Estatutos", "page": None}]),
            "📚 Fuente: Estatutos",
        )

    def test_no_sources_produces_no_footer(self):
        self.assertEqual(rag.format_sources([]), "")

    def test_law_uses_articles_instead_of_pdf_pages(self):
        self.assertEqual(
            rag.format_sources([
                {"title": "Ley de Propiedad Horizontal", "page": 14, "articles": ["7"], "doc_type": "law"},
                {"title": "Ley de Propiedad Horizontal", "page": 27, "articles": ["10", "7"], "doc_type": "law"},
            ]),
            "📚 Fuente: Ley de Propiedad Horizontal · artículos 7, 10",
        )

    def test_decree_uses_article_and_other_documents_keep_page(self):
        self.assertEqual(
            rag.format_sources([
                {"title": "Real Decreto 100/2026", "page": 5, "articles": ["único"]},
                {"title": "Acta", "page": 2},
            ]),
            "📚 Fuentes\n\n- Real Decreto 100/2026 · artículo único\n- Acta · página 2",
        )

    def test_legacy_legal_filename_is_recognized_without_doc_type(self):
        self.assertEqual(
            rag.format_sources([{"filename": "Codigo Civil.pdf", "page": 81, "articles": ["396"]}]),
            "📚 Fuente: Codigo Civil.pdf · artículo 396",
        )

    def test_unidentified_legal_article_does_not_fall_back_to_page(self):
        self.assertEqual(
            rag.format_sources([{"title": "Ley de Propiedad Horizontal", "page": 14}]),
            "📚 Fuente: Ley de Propiedad Horizontal",
        )


class LegalArticleTests(unittest.TestCase):
    def test_only_article_headings_identify_articles_of_the_source(self):
        self.assertEqual(
            rag.article_headings("Artículo 7.\nTexto que remite al artículo 396 del Código Civil.\nArtículo 8 bis.\nOtra regla."),
            ["7", "8 bis"],
        )

    def test_continuation_is_linked_to_its_preceding_article(self):
        previous = {"page": 24, "chunk_index": 0, "content": "Artículo 10.\nPrimera parte de la regla."}
        database = unittest.mock.MagicMock()
        database.table.return_value.select.return_value.eq.return_value.eq.return_value.lte.return_value.order.return_value.order.return_value.limit.return_value.execute.return_value.data = [previous]
        row = {"title": "Ley de Propiedad Horizontal", "document_id": "law-1", "community_id": "global", "page": 25, "chunk_index": 0, "content": "Continuación de la regla en la página siguiente."}
        result = rag.enrich_legal_sources(database, [row])
        self.assertEqual(result[0]["article_candidates"], ["10"])
        self.assertNotIn("article_candidates", row)

    def test_model_cannot_add_articles_absent_from_the_source(self):
        citations = [{"source_id": "S1", "article_candidates": ["7", "8"]}]
        rag.apply_article_citations(citations, {"S1": ["7", "999"], "S99": ["1"]})
        self.assertEqual(citations[0]["articles"], ["7"])

    def test_invalid_article_response_is_ignored(self):
        citations = [{"source_id": "S1", "article_candidates": ["7"]}]
        rag.apply_article_citations(citations, {"S1": [None, {}, "999"]})
        self.assertEqual(citations[0]["articles"], [])

    def test_generated_article_selection_reaches_the_final_footer(self):
        rows = [{"title": "Ley de Propiedad Horizontal", "page": 14, "content": "Artículo 6.\nUna regla.\nArtículo 7.\nOtra regla.", "semantic_similarity": 0.9}]
        with (
            patch.object(rag, "get_openai"),
            patch.object(rag, "get_supabase"),
            patch.object(rag, "hybrid_search", return_value=rows),
            patch.object(rag, "rerank_results", return_value=rows),
            patch.object(rag, "call_text_model", return_value='{"on_topic": true, "answer": "Consulta a la comunidad [S1].", "source_articles": {"S1": ["7", "999"]}}'),
        ):
            reply = rag.answer_question("¿Puedo hacer obras?", "comunidad-1")
        self.assertEqual(reply["answer"], "Consulta a la comunidad.\n\n📚 Fuente: Ley de Propiedad Horizontal · artículo 7")
        self.assertEqual(reply["citations"][0]["articles"], ["7"])


class AnswerFormattingTests(unittest.TestCase):
    def answer(self, text, community_finance=None):
        rows = [
            {"title": "Estatutos", "page": 3, "semantic_similarity": 0.9},
            {"title": "Acta", "page": 2, "semantic_similarity": 0.8},
        ]
        with (
            patch.object(rag, "get_openai"),
            patch.object(rag, "get_supabase"),
            patch.object(rag, "hybrid_search", return_value=rows),
            patch.object(rag, "rerank_results", return_value=rows),
            patch.object(rag, "generate_answer", return_value={
                "answer": text, "on_topic": True,
            }),
        ):
            return rag.answer_question(
                "¿Qué dicen los estatutos?", "comunidad-1",
                community_finance=community_finance,
            )

    def test_only_used_documents_appear_at_the_end(self):
        reply = self.answer("Necesitas autorización [S1].\n\nPuedes consultarlo con la gestora.")
        self.assertEqual(
            reply["answer"],
            "Necesitas autorización.\n\nPuedes consultarlo con la gestora."
            "\n\n📚 Fuente: Estatutos · página 3",
        )
        self.assertEqual([c["source_id"] for c in reply["citations"]], ["S1"])

    def test_uncited_documents_are_not_presented_as_sources(self):
        reply = self.answer("No tengo acceso al detalle de las facturas pendientes de la comunidad.")
        self.assertEqual(reply["citations"], [])
        self.assertNotIn("📚", reply["answer"])

    def test_finance_only_uses_singular_footer(self):
        reply = self.answer("El gasto total es de 100 € [CUENTAS].", '{"gasto_total_del_año": "100 €"}')
        self.assertEqual(
            reply["answer"],
            "El gasto total es de 100 €.\n\n📚 Fuente: Cuentas de la comunidad · resumen del ejercicio",
        )
        self.assertEqual(reply["citations"], [])

    def test_finance_and_documents_share_one_footer(self):
        reply = self.answer("El gasto es de 100 € [CUENTAS]. Consulta los estatutos [S1].", '{}')
        self.assertEqual(
            reply["answer"],
            "El gasto es de 100 €. Consulta los estatutos.\n\n📚 Fuentes\n\n"
            "- Estatutos · página 3\n- Cuentas de la comunidad · resumen del ejercicio",
        )

    def test_unknown_markers_do_not_create_sources(self):
        reply = self.answer("Consulta el documento [S99] y las cuentas [CUENTAS].")
        self.assertEqual(reply["answer"], "Consulta el documento y las cuentas.")
        self.assertEqual(reply["citations"], [])


if __name__ == "__main__":
    unittest.main()
