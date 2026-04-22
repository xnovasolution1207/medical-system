import React, { useState } from "react";
import { Search, Filter, ArrowUpDown, Download, Plus, Settings, LayoutGrid, List as ListIcon, Phone, Calendar as CalendarIcon, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Opportunity, Pipeline } from "./types";

interface OpportunitiesViewProps {
  opportunities: Opportunity[];
  pipeline?: Pipeline;
  onMoveOpportunity?: (id: string, stageId: string) => void;
}

export function OpportunitiesView({ opportunities, pipeline, onMoveOpportunity }: OpportunitiesViewProps) {
  const [viewMode, setViewMode] = useState<"board" | "list">("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [draggedOppId, setDraggedOppId] = useState<string | null>(null);

  const stages = pipeline?.stages ?? [];
  const stageLookup = new Map(stages.map((s) => [s.id, s.label] as const));

  const filteredOpps = opportunities.filter((o) =>
    o.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedOppId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    if (draggedOppId) {
      onMoveOpportunity?.(draggedOppId, targetStageId);
      setDraggedOppId(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="flex h-[68px] items-center justify-between px-4 border-b shrink-0 gap-4 overflow-x-auto bg-white dark:bg-slate-950">
        <h1 className="text-xl font-semibold">Oportunidades</h1>
        <div className="flex items-center gap-2">
          <div className="relative w-64 shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar oportunidad..." 
              className="pl-8 bg-muted/50"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2 shrink-0">
            <Filter className="h-4 w-4" />
            Filtros Avanzados
          </Button>
          <Button variant="outline" className="gap-2 shrink-0">
            <ArrowUpDown className="h-4 w-4" />
            Ordenar
          </Button>
          <Button variant="outline" className="gap-2 shrink-0">
            <Download className="h-4 w-4" />
            Importar
          </Button>
          <Button variant="outline" className="gap-2 shrink-0">
            <Settings className="h-4 w-4" />
            Gestionar campos
          </Button>
          <Button className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            Crear oportunidad
          </Button>
          
          <div className="flex items-center bg-muted/50 rounded-md p-1 shrink-0">
            <Button 
              variant={viewMode === "board" ? "secondary" : "ghost"} 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setViewMode("board")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button 
              variant={viewMode === "list" ? "secondary" : "ghost"} 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <ListIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {stages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No se encontró un pipeline en GoHighLevel.
          </div>
        ) : viewMode === "board" ? (
          <div className="flex gap-4 h-full pb-4 w-max">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className="flex flex-col w-72 bg-muted/30 rounded-lg border shrink-0"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                <div className="p-3 border-b bg-muted/50 rounded-t-lg flex items-center justify-between shrink-0">
                  <h3 className="font-medium text-sm">{stage.label}</h3>
                  <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
                    {filteredOpps.filter((o) => o.stageId === stage.id).length}
                  </span>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                  {filteredOpps
                    .filter((o) => o.stageId === stage.id)
                    .map((opp) => (
                      <div
                        key={opp.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, opp.id)}
                        className="bg-card border rounded-md p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer active:cursor-grabbing"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-medium text-sm">{opp.name}</h4>
                          <Avatar className="h-6 w-6">
                            <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                        </div>
                        <div className="space-y-1.5 mt-3">
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Globe className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <span className="truncate">{opp.source}</span>
                          </div>
                          {opp.monetaryValue ? (
                            <div className="flex items-center text-xs text-muted-foreground">
                              <Phone className="h-3.5 w-3.5 mr-2 shrink-0 opacity-0" />
                              <span className="truncate">${opp.monetaryValue}</span>
                            </div>
                          ) : null}
                          <div className="flex items-center text-xs text-muted-foreground">
                            <CalendarIcon className="h-3.5 w-3.5 mr-2 shrink-0" />
                            <span>{opp.date}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border rounded-lg bg-card max-w-6xl mx-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre del lead</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Medio de captación</TableHead>
                  <TableHead>Fecha de creación</TableHead>
                  <TableHead className="text-right">Propietario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOpps.map((opp) => (
                  <TableRow key={opp.id}>
                    <TableCell className="font-medium">{opp.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-muted/50">
                        {stageLookup.get(opp.stageId) ?? opp.stageId}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{opp.status}</TableCell>
                    <TableCell>{opp.source}</TableCell>
                    <TableCell>{opp.date}</TableCell>
                    <TableCell className="text-right">
                      <Avatar className="h-6 w-6 ml-auto">
                        <AvatarFallback>{opp.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredOpps.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                      No se encontraron oportunidades.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
