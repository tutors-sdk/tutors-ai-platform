// C4 model of the Tutors AI platform as code (Structurizr DSL).
// Render with: docker run -it --rm -p 8080:8080 -v $PWD/docs/c4:/usr/local/structurizr structurizr/lite
// Keep this in step with the repository: a new container or adapter package means a change here.

workspace "Tutors AI Platform" "Contextual assistance, learning analytics and course improvement for Tutors." {

    model {
        student = person "Student" "Uses Tutors to work through courses and labs."
        lecturer = person "Lecturer" "Authors courses and reviews insights and recommendations."

        tutors = softwareSystem "Tutors (tutors-mono-repo)" "Reader, catalogue, live and time apps. Publishes @tutors/ai-contract and the course export." "External"

        platform = softwareSystem "Tutors AI Platform" "Open-weight inference, evidence and insights on OpenShift on AWS." {
            inferenceApi = container "inference-api" "Composition root. Validates tokens, maps the contract to driving ports, wires adapters." "TypeScript" {
                contractAdapter = component "Contract HTTP adapter" "Validates the token and maps contract schemas to ports." "packages/contract"
                harness = component "Evaluation harness" "Runs golden sets through the same ports." "packages/evaluation"
                core = component "Core" "AssistStudent, RecordEvidence, ExplainLabInsights, RecommendInterventions, policy." "packages/core"
                ollamaAdapter = component "Ollama adapter" "LanguageModel port." "packages/adapters/ollama"
                contentAdapter = component "Course export adapter" "CourseContent port." "packages/adapters/course-content"
                postgresAdapter = component "PostgreSQL adapter" "EvidenceStore and LearnerMemory ports." "packages/adapters/postgres"
                keycloakAdapter = component "Keycloak adapter" "Identity port." "packages/adapters/keycloak"
                otelAdapter = component "OpenTelemetry adapter" "Telemetry port." "packages/adapters/otel"
            }
            insightsWorker = container "insights-worker" "Batch evidence processing and insight generation." "TypeScript"
            ollama = container "Ollama" "Serves open-weight models by digest from the GPU worker." "Ollama" "Model"
            postgres = container "PostgreSQL" "Evidence and learner memory." "PostgreSQL" "Database"
            keycloak = container "Keycloak" "OIDC realm for inference tokens." "Keycloak"
            otel = container "OpenTelemetry collector" "Traces, model metrics, evidence-trail log." "OpenTelemetry"
        }

        courseExport = softwareSystem "Course export" "Course material exported from Tutors." "External"

        student -> tutors "Learns with"
        lecturer -> tutors "Teaches with"
        tutors -> inferenceApi "Calls through @tutors/ai-contract" "HTTPS + OIDC token"
        inferenceApi -> courseExport "Retrieves material from"
        insightsWorker -> courseExport "Reads course context from"
        inferenceApi -> ollama "Completes and streams with" "HTTP, in-cluster only"
        inferenceApi -> postgres "Appends evidence, reads and writes memory"
        insightsWorker -> postgres "Reads evidence, writes insights"
        inferenceApi -> keycloak "Validates tokens with"
        inferenceApi -> otel "Emits to"

        contractAdapter -> core "Drives"
        harness -> core "Drives"
        core -> ollamaAdapter "LanguageModel"
        core -> contentAdapter "CourseContent"
        core -> postgresAdapter "EvidenceStore, LearnerMemory"
        core -> keycloakAdapter "Identity"
        core -> otelAdapter "Telemetry"
        ollamaAdapter -> ollama "HTTP"
        contentAdapter -> courseExport "Reads"
        postgresAdapter -> postgres "SQL"
        keycloakAdapter -> keycloak "OIDC"
        otelAdapter -> otel "OTLP"
    }

    views {
        systemContext platform "SystemContext" {
            include *
            autolayout lr
        }
        container platform "Containers" {
            include *
            autolayout lr
        }
        component inferenceApi "InferenceApiComponents" {
            include *
            autolayout lr
        }
        styles {
            element "External" {
                background #999999
            }
            element "Database" {
                shape cylinder
            }
        }
    }
}
