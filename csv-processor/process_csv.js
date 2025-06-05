name: Processamento CSV Visiotech

on:
  # Execução semanal (domingos às 02:00 UTC)
  schedule:
    - cron: '0 2 * * 0'
  
  # Execução manual
  workflow_dispatch:
    inputs:
      csv_file:
        description: 'Nome do ficheiro CSV na pasta csv-input/'
        required: false
        default: 'auto'
      upload_to_shopify:
        description: 'Upload automático para Shopify?'
        required: false
        default: 'true'
        type: choice
        options:
          - 'true'
          - 'false'
  
  # Execução quando novo CSV é adicionado
  push:
    paths:
      - 'csv-input/*.csv'

jobs:
  process-csv:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout código
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Instalar dependências
        run: |
          npm install
      
      - name: Criar diretórios necessários
        run: |
          mkdir -p csv-input
          mkdir -p csv-output
          mkdir -p logs
      
      - name: Verificar ficheiros CSV disponíveis
        run: |
          echo "📁 Ficheiros CSV disponíveis:"
          ls -la csv-input/ || echo "Nenhum ficheiro encontrado"
      
      - name: Processar CSV Visiotech
        run: |
          echo "🚀 Iniciando processamento CSV..."
          echo "⏰ Timestamp: $(date)"
          
          # CORREÇÃO: Encontrar automaticamente qualquer ficheiro CSV
          CSV_FILE=""
          
          # Se especificado manualmente e não é 'auto'
          if [ "${{ github.event.inputs.csv_file }}" != "" ] && [ "${{ github.event.inputs.csv_file }}" != "auto" ]; then
            MANUAL_FILE="csv-input/${{ github.event.inputs.csv_file }}"
            if [ -f "$MANUAL_FILE" ]; then
              CSV_FILE="$MANUAL_FILE"
              echo "📄 Usando ficheiro especificado: $CSV_FILE"
            else
              echo "⚠️ Ficheiro especificado não encontrado: $MANUAL_FILE"
            fi
          fi
          
          # Se não encontrou ficheiro manual, procurar automaticamente
          if [ -z "$CSV_FILE" ]; then
            echo "🔍 Procurando ficheiro CSV automaticamente..."
            
            # Procurar por padrões comuns
            for pattern in "visiotech_connect*.csv" "visiotech*.csv" "*.csv"; do
              FOUND_FILE=$(find csv-input -name "$pattern" -type f 2>/dev/null | head -n1)
              if [ ! -z "$FOUND_FILE" ]; then
                CSV_FILE="$FOUND_FILE"
                echo "📄 Ficheiro encontrado: $CSV_FILE"
                break
              fi
            done
          fi
          
          # Verificar se encontrou ficheiro
          if [ -z "$CSV_FILE" ]; then
            echo "❌ Nenhum ficheiro CSV encontrado na pasta csv-input/"
            echo "🔍 Ficheiros disponíveis:"
            find csv-input -type f 2>/dev/null || echo "Pasta vazia"
            exit 1
          fi
          
          echo "📄 Processando ficheiro: $CSV_FILE"
          
          # Definir nome do ficheiro de saída
          OUTPUT_FILE="csv-output/shopify_products_$(date +%Y%m%d_%H%M%S).csv"
          echo "📁 Ficheiro de saída: $OUTPUT_FILE"
          
          # Executar processamento
          node csv-processor/process_csv.js "$CSV_FILE" "$OUTPUT_FILE" 2>&1 | tee logs/processing_$(date +%Y%m%d_%H%M%S).log
          
          # Verificar se ficheiro foi criado
          if [ -f "$OUTPUT_FILE" ]; then
            echo "✅ Ficheiro CSV Shopify criado com sucesso: $OUTPUT_FILE"
            echo "📊 Linhas no ficheiro: $(wc -l < "$OUTPUT_FILE")"
          else
            echo "❌ Erro: Ficheiro CSV Shopify não foi criado"
            exit 1
          fi
      
      - name: Configurar variáveis de ambiente para Shopify
        env:
          SHOPIFY_STORE_URL: ${{ secrets.SHOPIFY_STORE_URL }}
          SHOPIFY_ACCESS_TOKEN: ${{ secrets.SHOPIFY_ACCESS_TOKEN }}
        run: |
          echo "SHOPIFY_STORE_URL=$SHOPIFY_STORE_URL" >> .env
          echo "SHOPIFY_ACCESS_TOKEN=$SHOPIFY_ACCESS_TOKEN" >> .env
      
      - name: Upload para Shopify (Automático)
        if: success() && (github.event.inputs.upload_to_shopify != 'false')
        env:
          SHOPIFY_STORE_URL: ${{ secrets.SHOPIFY_STORE_URL }}
          SHOPIFY_ACCESS_TOKEN: ${{ secrets.SHOPIFY_ACCESS_TOKEN }}
        run: |
          echo "🚀 Iniciando upload para Shopify..."
          echo "⏰ Timestamp: $(date)"
          
          # Debug: Listar ficheiros gerados
          echo "📁 Ficheiros em csv-output/:"
          ls -la csv-output/ || echo "Pasta csv-output não existe"
          
          # Encontrar ficheiro CSV gerado mais recente
          SHOPIFY_CSV=$(find csv-output -name "shopify_products_*.csv" -type f 2>/dev/null | sort | tail -n1)
          
          if [ -z "$SHOPIFY_CSV" ]; then
            echo "❌ Nenhum ficheiro CSV Shopify encontrado"
            echo "🔍 Tentando encontrar qualquer CSV em csv-output/:"
            find csv-output -name "*.csv" -type f 2>/dev/null || echo "Nenhum CSV encontrado"
            exit 1
          fi
          
          echo "📄 Fazendo upload: $SHOPIFY_CSV"
          echo "📊 Tamanho do ficheiro: $(wc -l < "$SHOPIFY_CSV") linhas"
          
          # Executar upload
          node csv-processor/upload_to_shopify.js "$SHOPIFY_CSV" 2>&1 | tee logs/upload_$(date +%Y%m%d_%H%M%S).log
      
      - name: Upload CSV processado
        if: success()
        uses: actions/upload-artifact@v4
        with:
          name: shopify-csv-${{ github.run_number }}
          path: |
            csv-output/*.csv
            logs/*.log
          retention-days: 30
      
      - name: Notificar Discord (Sucesso)
        if: success()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
        run: |
          if [ ! -z "$DISCORD_WEBHOOK_URL" ]; then
            PROCESSED_COUNT=$(grep "Produtos processados:" logs/processing*.log | tail -1 | grep -o '[0-9]\+' || echo "0")
            TOTAL_LINES=$(grep "Total linhas Shopify:" logs/processing*.log | tail -1 | grep -o '[0-9]\+' || echo "0")
            
            # Verificar se houve upload
            if [ -f logs/upload*.log ]; then
              CREATED_COUNT=$(grep "Produtos criados:" logs/upload*.log | tail -1 | grep -o '[0-9]\+' || echo "0")
              UPDATED_COUNT=$(grep "Produtos atualizados:" logs/upload*.log | tail -1 | grep -o '[0-9]\+' || echo "0")
              UPLOAD_STATUS="✅ **Upload concluído!**\n📦 **Criados:** $CREATED_COUNT\n🔄 **Atualizados:** $UPDATED_COUNT"
            else
              UPLOAD_STATUS="📁 **CSV gerado** (upload não executado)"
            fi
            
            curl -H "Content-Type: application/json" \
              -X POST \
              -d "{\"content\":\"✅ **CSV Visiotech processado com sucesso!**\n📊 **Produtos processados:** $PROCESSED_COUNT\n📄 **Linhas geradas:** $TOTAL_LINES\n$UPLOAD_STATUS\n⏰ **Data:** $(date)\n🔗 **Download:** GitHub Actions Artifacts\"}" \
              "$DISCORD_WEBHOOK_URL"
          fi
      
      - name: Notificar Discord (Erro)
        if: failure()
        env:
          DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}
        run: |
          if [ ! -z "$DISCORD_WEBHOOK_URL" ]; then
            curl -H "Content-Type: application/json" \
              -X POST \
              -d "{\"content\":\"❌ **Erro no processamento CSV Visiotech**\n⏰ **Data:** $(date)\n🔗 **Logs:** GitHub Actions\"}" \
              "$DISCORD_WEBHOOK_URL"
          fi
      
      - name: Upload logs em caso de erro
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: error-logs-${{ github.run_number }}
          path: logs/
          retention-days: 7

